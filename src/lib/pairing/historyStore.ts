import { type HistoryChunkStore, type HistoryStoreChooser, HistoryStoreError } from "@gryt/core";
import { base64Url } from "@gryt/crypto";

/* A linked device's history waits on one of the user's own servers, never Gryt's relay (GRYT-2055). */

export type HistoryFetch = (url: string, init: RequestInit) => Promise<Response>;

/** How this device reaches a server: its address and, once it has joined, its token. */
export interface ServerAccess {
  base(host: string): string;
  token(host: string): string | null;
}

/** The new device gets a token for the server once it has joined, which can take a while after the envelope. */
const TOKEN_WAIT_MS = 90_000;

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("aborted"))), { once: true });
  });

async function tokenFor(access: ServerAccess, host: string, signal?: AbortSignal, waitMs = TOKEN_WAIT_MS): Promise<string> {
  for (const start = Date.now(); ; await pause(1000, signal)) {
    const token = access.token(host);
    if (token) return token;
    if (Date.now() - start > waitMs) throw new HistoryStoreError("refused", `No session on ${host} to fetch history from.`);
  }
}

export function errorFor(status: number): HistoryStoreError {
  if (status === 404) return new HistoryStoreError("missing");
  if (status === 413 || status === 429) return new HistoryStoreError("full");
  // A stale token is refreshed by the socket; a server error may pass. Both are worth another try.
  if (status === 401 || (status >= 500 && status !== 503)) return new HistoryStoreError("network");
  return new HistoryStoreError("refused");
}

export function serverHistoryStore(access: ServerAccess, host: string, transfer: string, fetchImpl: HistoryFetch = fetch): HistoryChunkStore {
  const url = (n: number) => `${access.base(host)}/api/link-history/${transfer}/${n}`;
  async function call(method: string, n: number, signal?: AbortSignal, body?: Uint8Array): Promise<Response> {
    const token = await tokenFor(access, host, signal);
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    if (body) headers["content-type"] = "application/octet-stream";
    let res: Response;
    try {
      res = await fetchImpl(url(n), { method, signal, headers, body: body as BodyInit | undefined });
    } catch {
      throw new HistoryStoreError("network");
    }
    if (!res.ok) throw errorFor(res.status);
    return res;
  }
  return {
    put: async (n, sealed, signal) => void (await call("PUT", n, signal, sealed)),
    get: async (n, signal) => new Uint8Array(await (await call("GET", n, signal)).arrayBuffer()),
    delete: async (n) => void (await call("DELETE", n)),
  };
}

/** The first server this device is signed in to that says it holds linked devices' history. */
export function chooseHistoryServer(access: ServerAccess, fetchImpl: HistoryFetch = fetch): HistoryStoreChooser {
  return async (servers) => {
    for (const { host } of servers) {
      if (!access.token(host)) continue;
      const info = (await fetchImpl(`${access.base(host)}/info`, {})
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as { linkHistory?: boolean } | null;
      if (info?.linkHistory !== true) continue;
      const transfer = base64Url(crypto.getRandomValues(new Uint8Array(18)));
      return { host, transfer, store: serverHistoryStore(access, host, transfer, fetchImpl) };
    }
    return null;
  };
}
