// ── Remembered scheme ────────────────────────────────────────────────────────
//
// Plain is the default: Gryt's server has no TLS of its own, and a deployment
// that has it sits behind a proxy that redirects or refuses. Both are answers.

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
 * Whether this build may open a plain connection at all. The web client may not:
 * an https page cannot open http or ws to anything but loopback.
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
 * Deliberately unauthenticated: `Authorization` is what makes a request
 * preflighted, and a preflight may not be redirected.
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
 * The URL for a stored file, carrying the token allowed to read it. In the query
 * string because most of these become `<img src>`, which cannot send a header.
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
