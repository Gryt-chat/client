/// <reference lib="webworker" />

/**
 * The inside of a plugin (GRYT-930).
 *
 * One worker per plugin. This file is everything a plugin can see: a `gryt`
 * global whose every method is a message to the app, and the plugin's own code,
 * imported once this has been told where it is.
 *
 * What is deliberately absent is the point. There is no `window`, no `document`,
 * no `localStorage`, no socket, no identity key, and none of the app's modules.
 * A plugin that wants to do something it was not granted has nowhere to go —
 * which is what makes the capability list a boundary instead of a claim.
 *
 * There is no `addonId` argument on anything any more. It used to be a
 * parameter because one API served every plugin and each had to say who it was;
 * a plugin could say something else. The host stamps it now, from which worker
 * the message arrived on.
 */

import type { HostMessage, ThemeInfo, WorkerMessage } from "./workerProtocol";

/*
 * Taken away before the plugin is imported, and it cannot get them back.
 *
 * A worker has no `window`, no `document` and no `localStorage`, which is most
 * of what moving plugins here was for. It does still have origin storage — and
 * origin storage is the app's: `indexedDB` in here opens the same databases the
 * app writes to, so a plugin could read what it was refused by asking the
 * browser instead of asking Gryt.
 *
 * `Worker` goes with them, and that one is the reason the rest is worth doing:
 * a plugin that can start a worker of its own gets a fresh global with all of
 * this back, and everything above becomes a speed bump. A plugin has no other
 * use for one.
 *
 * What stays is the network — `fetch` and `WebSocket` — because a plugin
 * talking to something on the internet is a plugin doing its job, and a
 * now-playing plugin that cannot reach Spotify is not a plugin. So the honest
 * shape of this: a plugin cannot read what it was refused, and can send
 * anywhere it likes whatever it was given. The docs say that in those words.
 */
for (const name of ["indexedDB", "caches", "Worker", "SharedWorker"]) {
  /* Own property first, then up the chain: these are getters on the worker
     global's prototype rather than properties of the object, so deleting from
     `globalThis` alone does nothing at all. */
  let target: object | null = globalThis;
  while (target) {
    if (Object.prototype.hasOwnProperty.call(target, name)) {
      try {
        delete (target as Record<string, unknown>)[name];
      } catch {
        /* Non-configurable. Nothing more to do from in here. */
      }
      break;
    }
    target = Object.getPrototypeOf(target);
  }
}

const post = (message: WorkerMessage) => self.postMessage(message);

/*
 * Built rather than written, so the bundler cannot see it.
 *
 * A literal `import(url)` here is rewritten by Vite into
 * `import(__vite__injectQuery(url, "import"))`, which asks its dev server to
 * transform a file the dev server does not own — an addon is served from the
 * addons directory, not from source — and gets a 500. `@vite-ignore` does not
 * stop the query injection. The packaged build has no such transform, so the
 * failure only shows in development, which is the worst place for it to hide.
 *
 * Nothing is evaluated here beyond the importer itself: the plugin is still
 * fetched and run by the engine as a module, from the same origin as the app.
 */
const importPlugin = new Function("url", "return import(url)") as (
  url: string,
) => Promise<unknown>;

let nextCallId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function call(method: string, args: unknown[] = []): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextCallId++;
    pending.set(id, { resolve, reject });
    post({ kind: "call", id, method, args });
  });
}

type Handler = (payload: never) => void;
const handlers = new Map<string, Set<Handler>>();

function on(event: string, handler: Handler): () => void {
  const set = handlers.get(event) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(event, set);
  return () => {
    set.delete(handler);
    if (set.size === 0) handlers.delete(event);
  };
}

function dispatch(event: string, payload: unknown): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      (handler as (p: unknown) => void)(payload);
    } catch (err) {
      /* One handler's mistake must not stop the next, and must not take the
         worker down — an uncaught throw here would kill the plugin outright. */
      post({
        kind: "log",
        level: "error",
        message: `threw handling ${event}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}

let theme: ThemeInfo = { appearance: "dark", accentColor: "violet" };
let version = "";

/*
 * The whole surface. Everything here is a message; nothing is a shortcut.
 *
 * `messaging.servers()` is a promise where it used to be a plain array. It has
 * to be: the answer lives in the app and this is the other side of a port.
 * Making it look synchronous would have meant caching it here and being wrong
 * whenever a server appeared or went away.
 */
const gryt = {
  /* Annotated, unlike an inferred `string`, because the generated API
     reference reads this file as text and prints what it finds. Without it the
     reference listed `version` with no type beside it. */
  get version(): string {
    return version;
  },
  get theme(): ThemeInfo {
    return { ...theme };
  },
  /**
   * Hear about something.
   *
   * `themeChange` when the app's appearance or accent changes, and `cleanup`
   * when this plugin is being turned off — which is the only chance it gets to
   * clear a status or stop a timer. Whatever it does not finish quickly enough
   * happens anyway: the worker is terminated shortly after, from outside.
   */
  on(
    event: "themeChange" | "cleanup",
    handler: (payload: ThemeInfo | undefined) => void,
  ): () => void {
    return on(event, handler as Handler);
  },
  /**
   * Say what the person running this is doing. Needs `status`.
   *
   * An empty string clears it. Rejects if the capability was not granted,
   * rather than resolving quietly — a status that never appears is harder to
   * work out than an error.
   */
  setActivity(activity: string): Promise<unknown> {
    return call("setActivity", [activity]);
  },
  messaging: {
    /** Send to the copy of this plugin on the server. Needs `messaging`. */
    send(topic: string, data: unknown, host?: string): Promise<unknown> {
      return call("messaging.send", [topic, data, host]);
    },
    /** Hear from it. Needs `messaging`. */
    on(topic: string, handler: (message: unknown) => void): () => void {
      void call("messaging.subscribe", [topic]);
      return on(`message:${topic}`, handler as Handler);
    },
    /** Which servers run the other half. A round trip, so a promise. */
    servers(): Promise<string[]> {
      return call("messaging.servers", []) as Promise<string[]>;
    },
  },
  log: {
    info: (message: string) => post({ kind: "log", level: "info", message: String(message) }),
    warn: (message: string) => post({ kind: "log", level: "warn", message: String(message) }),
    error: (message: string) => post({ kind: "log", level: "error", message: String(message) }),
  },
};

(globalThis as unknown as { gryt: typeof gryt }).gryt = gryt;

self.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;

  if (message.kind === "load") {
    theme = message.theme;
    version = message.version;
    importPlugin(message.url).then(
      () => post({ kind: "ready" }),
      (err: unknown) =>
        post({ kind: "failed", error: err instanceof Error ? err.message : String(err) }),
    );
    return;
  }

  if (message.kind === "result") {
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.ok) waiting.resolve(message.value);
    else waiting.reject(new Error(message.error));
    return;
  }

  if (message.kind === "event") {
    if (message.event === "themeChange") theme = message.payload as ThemeInfo;
    dispatch(message.event, message.payload);
    return;
  }

  if (message.kind === "stop") {
    dispatch("cleanup", undefined);
    /* Closed from in here as well as terminated from out there. Whichever
       happens first, nothing is left running. */
    self.close();
  }
});
