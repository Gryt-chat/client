import { io } from "socket.io-client";

import { answerChallenge, clearIdentityCertificate, getServerWsBase } from "@/common";

import { challengeHostMatches } from "./challengeHost";
import { describeGap, guardSocket, serverProofErrorMessage } from "./serverAuth";

export type JoinServerOnceRequest = {
  host: string;
  nickname?: string;
  inviteCode?: string;
  /**
   * A line for whoever decides, on a server that admits people by request.
   *
   * Sent with the assertion rather than with the join, because the challenge
   * binds what must not change between the two steps — the nickname, the invite
   * claimed — and a note is a message to a person that nothing downstream
   * trusts.
   */
  note?: string;
};

export type JoinServerOnceSuccess = {
  accessToken: string;
  refreshToken?: string;
  nickname: string;
  avatarFileId?: string | null;
  isOwner?: boolean;
  setupRequired?: boolean;
};

export type JoinServerOnceError = {
  error: string;
  message?: string;
  retryAfterMs?: number;
  currentScore?: number;
  maxScore?: number;
  canReapply?: boolean;
  /**
   * Which half of the identity exchange the server refused.
   *
   * The server has always sent this and this type has never had a field for
   * it, so it was read off the wire and dropped. That is why a clock an hour
   * out was reported as the server trusting a different identity service: the
   * only message left to show was the one written for the other cause.
   */
  reason?: "certificate_rejected" | "assertion_rejected" | "nonce_mismatch" | "unknown";
  /**
   * How far this machine's clock is from the server's, when that is what the
   * server refused. Positive means we are behind it.
   */
  skewMs?: number;
};

export type JoinServerOnceResult =
  | { ok: true; joinInfo: JoinServerOnceSuccess }
  | { ok: false; error: JoinServerOnceError };

function describeConnectError(err: unknown, host: string): JoinServerOnceError {
  const raw = err instanceof Error ? err.message : String(err);

  console.error(`[JoinServer] connect_error for ${host}:`, raw);
  console.debug(`[JoinServer] diagnostics:`, {
    host,
    wsUrl: getServerWsBase(host),
    origin: typeof window !== "undefined" ? window.location.origin : "unknown",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    online: typeof navigator !== "undefined" ? navigator.onLine : "unknown",
  });

  if (/websocket/i.test(raw)) {
    return {
      error: "connect_error",
      message: `WebSocket connection failed — retrying with fallback. If this persists, the server may be unreachable. (${raw})`,
    };
  }
  if (/timeout/i.test(raw)) {
    return {
      error: "connect_error",
      message: `Connection timed out. The server may be down or your network is blocking the connection.`,
    };
  }
  if (/cors/i.test(raw)) {
    return {
      error: "connect_error",
      message: `Connection blocked by CORS policy. The server may not allow connections from this client.`,
    };
  }
  if (raw) {
    return { error: "connect_error", message: `Could not connect to the server: ${raw}` };
  }
  return { error: "connect_error", message: "Could not connect to the server." };
}

/**
 * Join, and if the server rejects our identity, renew the certificate and try
 * once more.
 *
 * getValidCertificate() already refuses to hand back a certificate that names a
 * key we no longer hold, which covers the case we have actually seen. This is
 * for the rest: a certificate the identity service has rotated away from, or
 * one signed by a key the server no longer trusts. Neither is visible from
 * here, and both are fixed by asking for a new one.
 *
 * Exactly one retry, and only for this error. Anything else — a ban, a bad
 * invite, an unreachable host — is not helped by a new certificate, and a
 * second attempt would just be a slower failure.
 */
export async function joinServerOnce(
  req: JoinServerOnceRequest,
  opts?: { timeoutMs?: number }
): Promise<JoinServerOnceResult> {
  const first = await attemptJoin(req, opts);

  if (first.ok || first.error?.error !== "identity_verification_failed") {
    return first;
  }

  // A clock is not something a certificate fixes, and the retry would sign the
  // second assertion from the same wrong clock as the first. Answer now, with
  // the number, rather than after a round trip that cannot change the outcome.
  if (first.error.skewMs !== undefined) {
    return { ok: false, error: clockSkewError(req.host, first.error.skewMs) };
  }

  console.warn(
    `[JoinServer] ${req.host} rejected our identity — renewing the certificate and retrying once.`
  );
  clearIdentityCertificate();

  const second = await attemptJoin(req, opts);

  if (!second.ok && second.error?.error === "identity_verification_failed") {
    if (second.error.skewMs !== undefined) {
      return { ok: false, error: clockSkewError(req.host, second.error.skewMs) };
    }

    // A fresh certificate did not help, so this is not something the client can
    // repair. Say what was tried and what to do, rather than repeating advice
    // that has already failed twice.
    return {
      ok: false,
      error: {
        error: "identity_verification_failed",
        reason: second.error.reason,
        message:
          `${req.host} would not accept your identity, and renewing it did not help. ` +
          `This usually means the server trusts a different identity service. ` +
          `Sign out and back in, and if it keeps happening the server's administrator ` +
          `needs to check that it points at the same Gryt identity service you do.`,
      },
    };
  }

  return second;
}

/**
 * The clock is wrong, and by how much.
 *
 * Worded from this machine's side, which is the one the reader can do something
 * about. The mirror of `serverProofErrorMessage`'s "expired" case, which says
 * the same thing about a server whose clock is off — see the note there about
 * why naming the direction beats asking somebody to compare two clocks.
 */
function clockSkewError(host: string, skewMs: number): JoinServerOnceError {
  const direction = skewMs > 0 ? "behind" : "ahead of";

  return {
    error: "identity_verification_failed",
    reason: "assertion_rejected",
    skewMs,
    message:
      `Your clock is about ${describeGap(Math.abs(skewMs))} ${direction} ` +
      `${host}'s, so the proof this app signs to join had already expired when ` +
      `it arrived. Turn on automatic time sync on this machine and try again.`,
  };
}

async function attemptJoin(
  req: JoinServerOnceRequest,
  opts?: { timeoutMs?: number }
): Promise<JoinServerOnceResult> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const wsUrl = getServerWsBase(req.host);

  console.log(`[JoinServer] Connecting to ${req.host} (${wsUrl})…`);

  return await new Promise<JoinServerOnceResult>((resolve) => {
    const socket = io(wsUrl, {
      transports: ["websocket"],
      reconnection: false,
      timeout: timeoutMs,
    });

    let settled = false;
    const finish = (res: JoinServerOnceResult) => {
      if (settled) return;
      settled = true;
      if (res.ok) {
        console.log(`[JoinServer] Successfully joined ${req.host}`);
      } else {
        console.warn(`[JoinServer] Failed to join ${req.host}:`, res.error);
      }
      try {
        socket.disconnect();
      } catch {
        // ignore
      }
      resolve(res);
    };

    // Authenticate the server before anything is sent to it (GRYT-51).
    guardSocket(socket, req.host, (decision) => {
      finish({
        ok: false,
        error: { error: "identity_error", message: serverProofErrorMessage(decision) },
      });
    });

    const timer = setTimeout(() => {
      console.warn(`[JoinServer] Timed out after ${timeoutMs}ms for ${req.host}`);
      finish({
        ok: false,
        error: { error: "timeout", message: "Timed out connecting to the server. Check the address and try again." },
      });
    }, timeoutMs + 250);

    socket.on("connect", () => {
      console.log(`[JoinServer] Connected to ${req.host}, sending join request…`);
      socket.emit("server:join", {
        nickname: req.nickname,
        inviteCode: req.inviteCode,
      });
    });

    socket.on("server:challenge", async (challenge: { nonce: string; serverHost: string }) => {
      // The assertion is bound to this host. Signing whatever the other end
      // names would let a server we did not dial collect an assertion valid
      // somewhere else.
      if (!challengeHostMatches(req.host, challenge.serverHost)) {
        console.error(
          `[JoinServer] Refusing to sign for ${req.host}: challenge claims to be ` +
            `"${challenge.serverHost}"`
        );
        clearTimeout(timer);
        finish({
          ok: false,
          error: {
            error: "identity_error",
            message:
              `This server identified itself as "${challenge.serverHost}" but you ` +
              `connected to "${req.host}". Not signing in.`,
          },
        });
        return;
      }

      console.log(`[JoinServer] Received challenge from ${req.host}, signing assertion…`);
      try {
        const { certificate, assertion, tier, link } = await answerChallenge(req.host, challenge);
        console.log(`[JoinServer] Answering as ${tier} identity`);
        socket.emit("server:verify", { certificate, assertion, link, note: req.note });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[JoinServer] Failed to answer challenge for ${req.host}:`, msg);
        clearTimeout(timer);
        finish({
          ok: false,
          error: { error: "identity_error", message: `Identity verification failed: ${msg}` },
        });
      }
    });

    socket.on("server:joined", (joinInfo: JoinServerOnceSuccess) => {
      clearTimeout(timer);
      finish({ ok: true, joinInfo });
    });

    socket.on("server:error", (error: JoinServerOnceError) => {
      clearTimeout(timer);
      console.error(`[JoinServer] server:error from ${req.host}:`, error);
      finish({ ok: false, error });
    });

    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: describeConnectError(err, req.host) });
    });
  });
}

