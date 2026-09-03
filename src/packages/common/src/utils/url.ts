// Whether a server is dialled over http/ws or https/wss.
//
// This used to guess from the host: an allowlist of loopback, the RFC1918
// ranges and `.local`, with everything else assumed secure. Every version of
// that guess leaks. It got public IPs wrong, and router names like
// `gryt.server`, and single-label hostnames, and Tailscale's CGNAT range, and
// link-local. Widening the list only moves the edge somewhere else, because
// there is no way to tell `gryt.server` from `gryt.chat` by looking at it.
//
// So it does not guess from the host any more. Plain is the default, because
// Gryt's server has no TLS of its own — `createServer` from `"http"` — and a
// deployment that does have it sits behind a proxy that will either redirect
// the plain request or refuse it. Both of those are answers, and `rememberScheme`
// records them, so the guess is wrong at most once per server.

// ── Remembered scheme ───────────────────────────────────────────────────

const SCHEME_KEY = "serverSchemeOverrides";

import { getServerFileToken } from "./tokenStorage";

export type Scheme = "http" | "https";

function readOverrides(): Record<string, Scheme> {
  try {
    const raw = localStorage.getItem(SCHEME_KEY);
    return raw ? (JSON.parse(raw) as Record<string, Scheme>) : {};
  } catch {
    return {};
  }
}

/** What actually answered for this host, if anything ever has. */
export function getRememberedScheme(host: string): Scheme | null {
  return readOverrides()[host] ?? null;
}

export function rememberScheme(host: string, scheme: Scheme): void {
  try {
    const all = readOverrides();
    if (all[host] === scheme) return;
    all[host] = scheme;
    localStorage.setItem(SCHEME_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable. The default still works, it just stops learning.
  }
}

export function forgetScheme(host: string): void {
  try {
    const all = readOverrides();
    if (!(host in all)) return;
    delete all[host];
    localStorage.setItem(SCHEME_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
}

/** Read the scheme back off a URL, for recording what actually served a reply. */
export function schemeOfUrl(url: string): Scheme | null {
  if (url.startsWith("https:")) return "https";
  if (url.startsWith("http:")) return "http";
  return null;
}

// ── Choosing one ────────────────────────────────────────────────────────

function isElectronRenderer(): boolean {
  try {
    return navigator.userAgent.toLowerCase().includes("electron");
  } catch {
    return false;
  }
}

/**
 * Whether this build may open a plain connection at all.
 *
 * The web client may not. An https page cannot open http or ws to anything but
 * loopback, and the browser blocks it before it reaches the network, so for
 * app.gryt.chat a secure connection is the only one that can ever work. This is
 * checked first and nothing below can override it.
 */
function canDialPlain(): boolean {
  try {
    const proto = window.location.protocol;
    if (proto === "http:" || proto === "file:") return true;
    if (isElectronRenderer()) return true;
    if ((window as Window & { electronAPI?: unknown }).electronAPI) return true;
  } catch {
    // No window. Assume the strict answer.
  }
  return false;
}

/** The scheme this host will be dialled with. */
export function schemeFor(host: string): Scheme {
  if (!canDialPlain()) return "https";
  return getRememberedScheme(host) ?? "http";
}

/** The other one, for retrying when the first attempt got nowhere. */
export function otherScheme(scheme: Scheme): Scheme {
  return scheme === "https" ? "http" : "https";
}

export function getServerHttpBase(host: string, scheme?: Scheme): string {
  return `${scheme ?? schemeFor(host)}://${host}`;
}

// ── Learning one ────────────────────────────────────────────────────────

/** How long to wait for `/info` before deciding nothing answered. */
const PROBE_TIMEOUT_MS = 8000;

const probesInFlight = new Map<string, Promise<Scheme>>();

/**
 * Find out which scheme a host actually answers on, once, and remember it.
 *
 * Adding a server records this already, from the `/info` call the join flow
 * makes. Nothing else did, so a server that has been in the list since before
 * that code — or was added on another machine and arrived through the profile
 * sync — never learned anything, and kept the default forever.
 *
 * On the desktop app the default is plain http, and a deployment behind a
 * proxy answers plain http with a redirect to https. `fetch` follows one on a
 * simple GET, so this finds out; a request the browser preflights does not get
 * that far, because a preflight may not be redirected. It fails as a CORS
 * error naming the redirect, with no status and nothing to retry against — so
 * avatar upload, link previews and emoji import were all dead against those
 * hosts, permanently and without a way back.
 *
 * Deliberately unauthenticated. The `Authorization` header is what makes a
 * request preflighted in the first place, and the reply's status does not
 * matter here — a private server answers 404 and that is a perfectly good
 * answer. All this reads is which scheme was on the other end of it.
 */
export async function ensureSchemeKnown(host: string): Promise<Scheme> {
  const known = getRememberedScheme(host);
  if (known) return known;
  if (!canDialPlain()) return "https";

  const existing = probesInFlight.get(host);
  if (existing) return existing;

  const probe = (async (): Promise<Scheme> => {
    const first = schemeFor(host);

    const attempt = async (scheme: Scheme): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        return await fetch(`${getServerHttpBase(host, scheme)}/info`, {
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let res: Response;
    try {
      res = await attempt(first);
    } catch {
      // Nothing answered, which says nothing about which scheme was wanted.
      try {
        res = await attempt(otherScheme(first));
      } catch {
        // Host is unreachable either way. Leave it unrecorded so the next
        // startup tries again rather than pinning a guess made offline.
        return first;
      }
    }

    const served = schemeOfUrl(res.url) ?? first;
    rememberScheme(host, served);
    return served;
  })().finally(() => {
    probesInFlight.delete(host);
  });

  probesInFlight.set(host, probe);
  return probe;
}

export function getServerWsBase(host: string): string {
  return `${schemeFor(host) === "https" ? "wss" : "ws"}://${host}`;
}

/**
 * The URL for a stored file, carrying the token that is allowed to read it.
 *
 * The token is in the query string rather than a header because most of these
 * become `<img src>` — avatars in the member list, pictures in the chat, a
 * group's icon — and an image element has no way to send one. Everything that
 * builds one of these URLs goes through here, which is why adding the
 * credential was a change to one function rather than to twenty call sites.
 *
 * A missing token still returns a URL. The server answers 401 and the picture
 * fails, which is the same thing that happens to a token that expired, and is
 * better than a call site having to decide what to render instead.
 */
export function getUploadsFileUrl(
  host: string,
  fileId: string,
  opts?: { thumb?: boolean }
): string {
  const base = getServerHttpBase(host);
  const params = new URLSearchParams();
  if (opts?.thumb) params.set("thumb", "1");
  const token = getServerFileToken(host);
  if (token) params.set("t", token);
  const q = params.toString();
  return `${base}/api/uploads/files/${fileId}${q ? `?${q}` : ""}`;
}
