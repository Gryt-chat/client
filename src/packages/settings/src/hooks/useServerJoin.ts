import { useCallback, useState } from "react";

import {
  getServerAccessToken,
  getServerHttpBase,
  normalizeCode,
  normalizeHost,
  otherScheme,
  rememberScheme,
  type Scheme,
  schemeFor,
  schemeOfUrl,
  setServerAccessToken,
  setServerRefreshToken,
} from "@/common";
import { joinServerOnce } from "@/socket";

import { useServerManagement } from "../../../socket/src/hooks/useServerManagement";
import { useSettings } from "./useSettings";

/**
 * What a server says about itself before anybody has joined it.
 *
 * Everything past `name` and `members` is optional because it is answered by
 * servers of different ages. A field that is absent is not a field that is
 * false — an older server sends no `identityTiers` at all, and claiming "no
 * account needed" on that basis is a guess that turns into a refusal.
 */
export type FetchInfo = {
  serverId?: string;
  name: string;
  description?: string;
  members: string;
  lanOpen?: boolean;
  identityTiers?: ("account" | "local")[];
  joinPolicy?: "invite" | "request" | "open";
};

/**
 * Give up on /info after this long.
 *
 * Without a deadline the fetch runs until the OS gives up on the TCP connect,
 * which is over a minute on macOS — a minute of a spinner with nothing
 * explaining it. A server that advertises an address it does not listen on,
 * which the dev servers do by binding loopback while announcing their
 * hostname, hits this every time.
 */
export const INFO_TIMEOUT_MS = 8000;

export type InfoResult =
  /** The server answered. */
  | { kind: "info"; info: FetchInfo }
  /** Public info is switched off. Joining may still work with a code. */
  | { kind: "private" }
  /** Superseded by a newer lookup — the newer one owns the UI now. */
  | { kind: "superseded" }
  | { kind: "error"; message: string };

/**
 * Ask a server to describe itself.
 *
 * Separate from the hook below because Discovery fetches this for a row it is
 * about to join and the join modal fetches it for whatever was pasted, and
 * neither wants the other's state.
 */
export async function fetchServerInfo(
  host: string,
  signal?: AbortSignal,
): Promise<InfoResult> {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return { kind: "error", message: "No address" };

  const controller = new AbortController();
  const abortOuter = () => controller.abort();
  signal?.addEventListener("abort", abortOuter);

  // Distinguishes "we gave up" from "a newer request replaced this one", which
  // the abort alone cannot tell apart.
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, INFO_TIMEOUT_MS);

  const headers: Record<string, string> = {};
  const storedToken = getServerAccessToken(normalizedHost);
  if (storedToken) headers.Authorization = `Bearer ${storedToken}`;

  try {
    // Plain is the default, so the first attempt at an unknown server is http.
    // Except when there is a token to send: a bearer over plain http to a host
    // that turns out to be public would leak it before the redirect that would
    // have protected it, and a server we hold a token for has been reached
    // before anyway.
    const first: Scheme = storedToken
      ? "https"
      : schemeFor(normalizedHost);

    let res: Response;
    try {
      res = await fetch(`${getServerHttpBase(normalizedHost, first)}/info`, {
        signal: controller.signal,
        headers,
      });
    } catch (reachErr) {
      // Nothing answered. That says nothing about which scheme was wanted, so
      // try the other rather than giving up. Only a transport failure retries:
      // a server that replied with an error has been reached, and dialling it
      // again differently would just be noise.
      if (controller.signal.aborted) throw reachErr;
      res = await fetch(
        `${getServerHttpBase(normalizedHost, otherScheme(first))}/info`,
        { signal: controller.signal, headers },
      );
    }

    // Recorded from the reply rather than from what was asked for, because a
    // proxy on port 80 answers a plain request with a redirect to https and
    // `fetch` follows it. That succeeds while proving the opposite of what was
    // guessed, and the WebSocket has no redirect to follow later.
    const served = schemeOfUrl(res.url);
    if (served) rememberScheme(normalizedHost, served);

    if (res.status === 404) return { kind: "private" };
    if (!res.ok) {
      return { kind: "error", message: `Server responded with ${res.status}` };
    }

    return { kind: "info", info: (await res.json()) as FetchInfo };
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      if (!timedOut) return { kind: "superseded" };
      return {
        kind: "error",
        message:
          "No response from this server. It may be advertising an address it is not reachable on.",
      };
    }
    // A network-layer failure gives you "Failed to fetch" (or "Load failed" on
    // WebKit), which describes the call rather than the situation and names no
    // cause worth repeating. What is actually known is that nothing answered.
    const message = err instanceof Error ? err.message : "";
    if (
      err instanceof TypeError ||
      message === "Failed to fetch" ||
      message === "Load failed"
    ) {
      return { kind: "error", message: "Nothing answered at this address." };
    }

    return { kind: "error", message: message || "Server is not responding" };
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortOuter);
  }
}

export type JoinOutcome =
  | { ok: true }
  /** Somebody has to let you in by hand. Not a failure and not worth retrying. */
  | { ok: false; kind: "approval_pending"; message: string }
  /** The server wants a code, or the one given was wrong. */
  | { ok: false; kind: "invite_required"; message: string }
  /** Already a member. The caller has been switched to it. */
  | { ok: false; kind: "already_member"; message: string }
  | { ok: false; kind: "error"; message: string };

/**
 * Turn a join failure into a line somebody can act on.
 *
 * The generic branch is the last resort on purpose. Every case above it reads
 * as somebody's fault otherwise — most of all `identity_tier_refused`, where
 * nothing about the address or the code is wrong and the only useful thing to
 * say is that this server wants an account.
 */
function describeJoinError(error: { error: string; message?: string }): JoinOutcome {
  switch (error.error) {
    case "approval_pending":
      return {
        ok: false,
        kind: "approval_pending",
        message:
          "Asked. Somebody who runs this server has to let you in — once they do, adding it again will work.",
      };
    case "invite_required":
      return {
        ok: false,
        kind: "invite_required",
        message:
          error.message || "This server is invite-only. Paste an invite code to join.",
      };
    case "invalid_invite":
      return {
        ok: false,
        kind: "invite_required",
        message: error.message || "Invalid invite code.",
      };
    case "identity_tier_refused":
      return {
        ok: false,
        kind: "error",
        message:
          "This server requires a Gryt account. Sign in from the menu at the bottom left, then try again.",
      };
    case "invite_rate_limited":
    case "rate_limited":
      return {
        ok: false,
        kind: "error",
        message: error.message || "Too many attempts. Please wait and try again.",
      };
    case "connect_error":
      return {
        ok: false,
        kind: "error",
        message:
          error.message ||
          "Could not connect to the server. Check the address and your network.",
      };
    case "timeout":
      return {
        ok: false,
        kind: "error",
        message:
          error.message ||
          "Connection timed out. The server may be down or unreachable.",
      };
    default:
      return {
        ok: false,
        kind: "error",
        message: error.message || `Failed to join server: ${error.error}`,
      };
  }
}

export interface JoinRequest {
  host: string;
  /** From /info, when it answered. Supplies the name and the id we store. */
  info?: FetchInfo | null;
  inviteCode?: string;
  note?: string;
}

/**
 * Joining a server, in one place.
 *
 * Both the join modal and Discovery do exactly this, and the error mapping
 * above is the part worth not having two copies of — every branch in it was
 * added because some failure had been reading as the wrong thing.
 */
export function useServerJoin() {
  const { addServer, servers, switchToServer } = useServerManagement();
  const { nickname } = useSettings();
  /** The host currently being joined, so a list can mark only its own row. */
  const [joiningHost, setJoiningHost] = useState<string | null>(null);

  const join = useCallback(
    async ({ host, info, inviteCode, note }: JoinRequest): Promise<JoinOutcome> => {
      const normalizedHost = normalizeHost(host);
      if (!normalizedHost) {
        return { ok: false, kind: "error", message: "No address" };
      }

      const existingByHost = servers[normalizedHost];
      if (existingByHost) {
        switchToServer(existingByHost.host);
        return {
          ok: false,
          kind: "already_member",
          message: "You are already a member of this server.",
        };
      }

      if (info?.serverId) {
        const existingById = Object.entries(servers).find(
          ([, server]) => !!server.serverId && server.serverId === info.serverId,
        );
        if (existingById) {
          switchToServer(existingById[0]);
          return {
            ok: false,
            kind: "already_member",
            message: "You are already connected to this server.",
          };
        }
      }

      const code = normalizeCode(inviteCode || "");

      setJoiningHost(normalizedHost);
      try {
        const result = await joinServerOnce({
          host: normalizedHost,
          nickname,
          inviteCode: code.length > 0 ? code : undefined,
          note: note && note.trim().length > 0 ? note.trim() : undefined,
        });

        if (!result.ok) return describeJoinError(result.error);

        setServerAccessToken(normalizedHost, result.joinInfo.accessToken);
        if (result.joinInfo.refreshToken) {
          setServerRefreshToken(normalizedHost, result.joinInfo.refreshToken);
        }

        addServer(
          {
            name: info?.name || normalizedHost,
            host: normalizedHost,
            serverId: info?.serverId,
          },
          true,
        );

        return { ok: true };
      } finally {
        setJoiningHost(null);
      }
    },
    [addServer, nickname, servers, switchToServer],
  );

  return { join, joiningHost };
}
