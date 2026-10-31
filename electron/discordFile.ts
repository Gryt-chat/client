/* eslint-disable @typescript-eslint/ban-types -- the url comes over IPC from the page, and is checked here. */
/* Discord's CDN only sends CORS headers for media, so a PDF or a zip can't be fetched from the page.
   The main process can, for these addresses and nothing else. */
const HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
const MAX_BYTES = 1024 * 1024 * 1024;

export function isDiscordFileUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && HOSTS.has(u.hostname) && u.pathname.startsWith("/attachments/");
  } catch {
    return false;
  }
}

export interface DiscordFileAnswer {
  status: number;
  type: string;
  retryAfter: string | null;
  bytes: Uint8Array | null;
}

export async function fetchDiscordFile(url: unknown, get: (url: string, init: { redirect: "error" }) => Promise<Response>): Promise<DiscordFileAnswer> {
  if (!isDiscordFileUrl(url)) throw new Error("Not a Discord file address.");
  const res = await get(url, { redirect: "error" });
  const none = { status: res.status, type: "", retryAfter: res.headers.get("retry-after"), bytes: null };
  if (!res.ok || Number(res.headers.get("content-length")) > MAX_BYTES) {
    await res.body?.cancel();
    return none;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.length > MAX_BYTES ? none : { ...none, type: res.headers.get("content-type") ?? "", bytes };
}
