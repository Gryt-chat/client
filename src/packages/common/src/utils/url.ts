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

export function getServerWsBase(host: string): string {
  return `${schemeFor(host) === "https" ? "wss" : "ws"}://${host}`;
}

export function getUploadsFileUrl(
  host: string,
  fileId: string,
  opts?: { thumb?: boolean }
): string {
  const base = getServerHttpBase(host);
  const q = opts?.thumb ? "?thumb=1" : "";
  return `${base}/api/uploads/files/${fileId}${q}`;
}
