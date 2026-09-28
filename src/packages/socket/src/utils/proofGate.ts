/**
 * Holds HTTP requests that carry a bearer token to a Gryt server until a socket to that
 * server has proved its identity (GRYT-1547). `guardSocket` tells it; `fetch` and XHR ask.
 */

/** How long a request waits for a proof before it fails the way a dead server would. */
export const PROOF_WAIT_MS = 15_000;

interface HostState {
  /** Connections to this host that proved themselves and are still open. */
  proved: Set<object>;
  /** The last guard to settle refused it, and nothing proved since. */
  refused: boolean;
  waiters: Set<{ resolve: () => void; reject: (err: Error) => void }>;
}

const hosts = new Map<string, HostState>();

// hostname:port with the default ports dropped, so "example.com:443" and an https URL agree.
function keyOf(hostname: string, port: string): string {
  const p = port === "80" || port === "443" ? "" : port;
  return `${hostname.toLowerCase()}:${p}`;
}

function keyOfHost(host: string): string | null {
  try {
    const url = new URL(`http://${host}`);
    return keyOf(url.hostname, url.port);
  } catch {
    return null;
  }
}

function keyOfUrl(input: string): string | null {
  try {
    const url = new URL(input, globalThis.location?.href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return keyOf(url.hostname, url.port);
  } catch {
    return null;
  }
}

function stateFor(host: string): HostState | null {
  const key = keyOfHost(host);
  if (!key) return null;
  let state = hosts.get(key);
  if (!state) {
    state = { proved: new Set(), refused: false, waiters: new Set() };
    hosts.set(key, state);
  }
  return state;
}

/** A guard now looks after this host, so bearer requests to it wait for a proof. */
export function watchHost(host: string): void {
  installProofGate();
  const state = stateFor(host);
  // A new guard is a new attempt, so requests wait for it rather than failing on the last refusal.
  if (state) state.refused = false;
}

export function markProved(host: string, connection: object): void {
  const state = stateFor(host);
  if (!state) return;
  state.proved.add(connection);
  state.refused = false;
  for (const w of state.waiters) w.resolve();
  state.waiters.clear();
}

/** The connection went. Requests after this wait for the next one to prove itself. */
export function markGone(host: string, connection: object): void {
  stateFor(host)?.proved.delete(connection);
}

export function markRefused(host: string, connection: object): void {
  const state = stateFor(host);
  if (!state) return;
  state.proved.delete(connection);
  if (state.proved.size > 0) return;
  state.refused = true;
  const err = new Error(`${host} has not proved its identity, so nothing that carries your token goes to it.`);
  for (const w of state.waiters) w.reject(err);
  state.waiters.clear();
}

/** True when a request to `url` has to wait: its server is watched and nothing to it has proved itself. */
export function mustWait(url: string): boolean {
  const key = keyOfUrl(url);
  const state = key ? hosts.get(key) : undefined;
  return !!state && state.proved.size === 0;
}

/** Resolves once `url`'s server has proved itself. Rejects on a refusal or after `PROOF_WAIT_MS`. */
export function waitForProof(url: string, signal?: AbortSignal | null): Promise<void> {
  const key = keyOfUrl(url);
  const state = key ? hosts.get(key) : undefined;
  if (!state || state.proved.size > 0) return Promise.resolve();
  if (state.refused) {
    return Promise.reject(new Error(`${key} has not proved its identity, so nothing that carries your token goes to it.`));
  }
  return new Promise<void>((resolve, reject) => {
    const waiter = {
      resolve: () => {
        done();
        resolve();
      },
      reject: (err: Error) => {
        done();
        reject(err);
      },
    };
    const timer = setTimeout(
      () => waiter.reject(new Error(`${key} did not prove its identity in time.`)),
      PROOF_WAIT_MS,
    );
    const onAbort = () => waiter.reject(signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"));
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      state.waiters.delete(waiter);
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort);
    state.waiters.add(waiter);
  });
}

const bearer = (value: string | null | undefined): boolean => !!value && /^bearer\s/i.test(value.trim());

let installed = false;

/** Wraps `fetch` and `XMLHttpRequest` once. Only a bearer request to a watched host waits. */
export function installProofGate(): void {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch?.bind(globalThis);
  if (originalFetch) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = typeof Request !== "undefined" && input instanceof Request ? input : null;
      const url = request ? request.url : String(input);
      const headers = new Headers(init?.headers ?? request?.headers);
      if (bearer(headers.get("authorization")) && mustWait(url)) {
        await waitForProof(url, init?.signal ?? request?.signal);
      }
      return originalFetch(input, init);
    }) as typeof fetch;
  }

  const Xhr = globalThis.XMLHttpRequest;
  if (!Xhr) return;
  const opened = new WeakMap<XMLHttpRequest, { url: string; bearer: boolean }>();
  const { open, setRequestHeader, send } = Xhr.prototype;

  Xhr.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    opened.set(this, { url: String(args[1]), bearer: false });
    return (open as (...a: unknown[]) => void).apply(this, args);
  } as typeof open;

  Xhr.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const seen = opened.get(this);
    if (seen && name.toLowerCase() === "authorization" && bearer(value)) seen.bearer = true;
    return setRequestHeader.call(this, name, value);
  };

  Xhr.prototype.send = function (this: XMLHttpRequest, body?: XMLHttpRequestBodyInit | null) {
    const seen = opened.get(this);
    if (!seen?.bearer || !mustWait(seen.url)) return send.call(this, body);
    waitForProof(seen.url).then(
      () => send.call(this, body),
      // What a network failure looks like to whoever listens, so the caller's error path runs.
      () => {
        const event = (type: string) => (typeof ProgressEvent === "function" ? new ProgressEvent(type) : new Event(type));
        this.dispatchEvent(event("error"));
        this.dispatchEvent(event("loadend"));
      },
    );
  };
}
