import { savePreLoginUrl } from "./preLoginUrl";

export type PendingInvite = {
  host: string;
  code: string;
  capturedAt: number;
};

const PENDING_INVITE_KEY = "pendingInvite";

export function normalizeHost(input: string): string {
  let h = String(input || "").trim();
  h = h.replace(/^(wss?:\/\/|https?:\/\/)/i, "");
  h = h.split("/")[0] || "";
  h = h.replace(/\s+/g, "");
  return h;
}

export function normalizeCode(input: string): string {
  return String(input || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * The default host for a legacy `/invite/<code>` link.
 *
 * Those links carry no host, and the only client ever served from a path like
 * that is the hosted one. Kept here so the join field and the URL capture below
 * agree on it rather than each picking their own.
 */
const DEFAULT_LEGACY_HOST = "app.gryt.chat";

export type ServerInput = {
  /** Empty when nothing usable was in the input. */
  host: string;
  /** Empty for a plain address, which carries no code. */
  code: string;
};

/**
 * Read whatever somebody pasted into the join field.
 *
 * Three shapes arrive and they are not the same thing: a full invite link
 * (`https://gryt.chat/invite?host=…&code=…`), a legacy one
 * (`https://app.gryt.chat/invite/<code>`), and a plain address (`gryt.chat`,
 * `192.168.1.5:5001`). normalizeHost on its own is wrong for the first two — it
 * returns the *link's* host, which is gryt.chat, and joining that instead of
 * the server named in the query is a confusing failure rather than an obvious
 * one.
 *
 * Anything that does not parse as a link falls through to being an address, so
 * a typo in a URL still gets the address treatment rather than an error about
 * invite formats.
 */
export function parseServerInput(
  input: string,
  opts?: { defaultLegacyHost?: string },
): ServerInput {
  const raw = String(input || "").trim();
  if (!raw) return { host: "", code: "" };

  const legacyHost = normalizeHost(opts?.defaultLegacyHost || DEFAULT_LEGACY_HOST);

  // Only something carrying a scheme can be a link. Without this, `gryt.chat`
  // parses as a URL in some engines with "gryt.chat" as the protocol.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const path = url.pathname || "/";
      // gryt://invite?host=…&code=… puts "invite" in the authority rather than
      // the path, because the scheme is not one the URL parser treats as
      // special. Both spellings mean the same thing.
      const isInvite = path.startsWith("/invite") || url.hostname === "invite";

      if (isInvite) {
        const host = normalizeHost(url.searchParams.get("host") || "");
        const code = normalizeCode(url.searchParams.get("code") || "");
        if (host && code) return { host, code };

        const parts = path.split("/").filter(Boolean);
        if (parts[0] === "invite" && parts[1]) {
          return { host: legacyHost, code: normalizeCode(parts[1]) };
        }
      }
    } catch {
      // Not a URL after all. It is still probably an address.
    }
  }

  return { host: normalizeHost(raw), code: "" };
}

export function readPendingInvite(): PendingInvite | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const host = normalizeHost(parsed?.host || "");
    const code = normalizeCode(parsed?.code || "");
    if (!host || !code) return null;
    return { host, code, capturedAt: Number(parsed?.capturedAt) || Date.now() };
  } catch {
    return null;
  }
}

export function writePendingInvite(host: string, code: string): PendingInvite | null {
  const h = normalizeHost(host);
  const c = normalizeCode(code);
  if (!h || !c) return null;
  const pending: PendingInvite = { host: h, code: c, capturedAt: Date.now() };
  try {
    window.sessionStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(pending));
  } catch {
    // ignore
  }
  return pending;
}

export function clearPendingInvite(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // ignore
  }
}

export function capturePendingInviteFromUrl(opts?: { defaultLegacyHost?: string }): PendingInvite | null {
  if (typeof window === "undefined") return null;

  const defaultLegacyHost = normalizeHost(opts?.defaultLegacyHost || DEFAULT_LEGACY_HOST);
  const { location, history } = window;

  const pathname = location.pathname || "/";
  const search = location.search || "";

  let host = "";
  let code = "";

  // Preferred: /invite?host=...&code=...
  const sp = new URLSearchParams(search);
  const hostParam = sp.get("host") || "";
  const codeParam = sp.get("code") || "";

  if (pathname.startsWith("/invite") && hostParam && codeParam) {
    host = hostParam;
    code = codeParam;
  } else {
    // Legacy: /invite/<code>
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "invite" && typeof parts[1] === "string" && parts[1].length > 0) {
      host = defaultLegacyHost;
      code = parts[1];
    }
  }

  host = normalizeHost(host);
  code = normalizeCode(code);

  if (!host || !code) return null;

  const pending: PendingInvite = { host, code, capturedAt: Date.now() };

  try {
    window.sessionStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(pending));
  } catch {
    // ignore
  }

  // Save the full URL before cleaning so login/register can redirect back here.
  savePreLoginUrl();

  // Clean the URL so the code doesn't remain visible longer than necessary.
  try {
    if (pathname.startsWith("/invite")) {
      history.replaceState(null, "", "/");
    } else if (sp.has("host") || sp.has("code")) {
      sp.delete("host");
      sp.delete("code");
      const nextSearch = sp.toString();
      history.replaceState(null, "", `${pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash || ""}`);
    }
  } catch {
    // ignore
  }

  return pending;
}

