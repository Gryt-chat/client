import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

/**
 * What lets an upload URL through (GRYT-1549). Held in memory only and set from the socket,
 * which waits for the server's identity proof, so nothing is signed for a server before that.
 */

/** What a current server sends with `server:joined` and `token:refreshed`. */
export interface FileUrlKey {
  key: string;
  user: string;
  until: number;
  now: number;
}

/** URLs expire at the end of the next five-minute step, so they hold still between steps. */
export const FILE_URL_STEP_S = 300;

interface HeldKey {
  bytes: Uint8Array;
  user: string;
  until: number;
  /** The server's clock minus ours, from the `now` it sent. */
  skewMs: number;
}

type Access = { key: HeldKey } | { token: string };

const access = new Map<string, Access>();
const listeners = new Set<(host: string) => void>();

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let c = 0; c < chars; c++) out += B64[(n >> (18 - 6 * c)) & 63];
  }
  return out;
}

function fromBase64Url(text: string): Uint8Array | null {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of text) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function readKey(raw: unknown, nowMs: number): HeldKey | null {
  if (!raw || typeof raw !== "object") return null;
  const k = raw as Partial<FileUrlKey>;
  if (typeof k.key !== "string" || typeof k.user !== "string" || !k.user) return null;
  if (typeof k.until !== "number" || typeof k.now !== "number") return null;
  const bytes = fromBase64Url(k.key);
  if (!bytes || bytes.length < 32) return null;
  return { bytes, user: k.user, until: k.until, skewMs: k.now - nowMs };
}

function notify(host: string): void {
  for (const listener of listeners) listener(host);
}

/**
 * What a server handed over, held in memory. A key wins over a token and replaces it, so a
 * server that signs never sees `?t=` again. Says which it took, or null for neither.
 */
export function holdServerFileAccess(
  host: string,
  grant: { fileKey?: unknown; fileToken?: string | null },
  nowMs = Date.now(),
): "key" | "token" | null {
  const key = readKey(grant.fileKey, nowMs);
  if (key) access.set(host, { key });
  else if (grant.fileToken) access.set(host, { token: grant.fileToken });
  else return null;
  notify(host);
  return key ? "key" : "token";
}

export function forgetServerFileAccess(host: string): void {
  if (access.delete(host)) notify(host);
}

export function forgetAllServerFileAccess(): void {
  const hosts = [...access.keys()];
  access.clear();
  hosts.forEach(notify);
}

export function hasServerFileAccess(host: string): boolean {
  return access.has(host);
}

/** Called with the host whenever what signs its URLs changes. Returns the unsubscribe. */
export function subscribeServerFileAccess(listener: (host: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The bytes the server signs. Kept byte-for-byte with the server's `fileUrlMessage`. */
export function fileUrlMessage(fileId: string, thumb: boolean, expires: number): string {
  return ["file-url", fileId, thumb ? "thumb" : "full", String(expires)].join("\n");
}

export function signFileUrl(key: Uint8Array, fileId: string, thumb: boolean, expires: number): string {
  return toBase64Url(hmac(sha256, key, utf8ToBytes(fileUrlMessage(fileId, thumb, expires))));
}

/** The query parameters that let `fileId` through on `host`, or none before the socket gave any. */
export function fileAccessParams(
  host: string,
  fileId: string,
  thumb: boolean,
  nowMs = Date.now(),
): [string, string][] {
  const held = access.get(host);
  if (!held) return [];
  if ("token" in held) return [["t", held.token]];

  const { bytes, user, until, skewMs } = held.key;
  const now = Math.floor((nowMs + skewMs) / 1000);
  const expires = Math.min((Math.floor(now / FILE_URL_STEP_S) + 2) * FILE_URL_STEP_S, until);
  return [
    ["u", user],
    ["k", String(until)],
    ["e", String(expires)],
    ["s", signFileUrl(bytes, fileId, thumb, expires)],
  ];
}
