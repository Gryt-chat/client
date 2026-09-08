/// <reference lib="webworker" />

/**
 * The inside of a plugin: a `gryt` global whose every method is a message to the
 * app. No `window`, no socket, no identity key, none of the app's modules.
 */

import type { HostMessage, ThemeInfo, WorkerMessage } from "./workerProtocol";

/*
 * Taken away before the plugin is imported. `indexedDB` opens the app's own
 * databases, and a `Worker` would hand all of this back with a fresh global.
 */
for (const name of ["indexedDB", "caches", "Worker", "SharedWorker"]) {
  /* Own property first, then up the chain: these are getters on the worker
     global's prototype, so deleting from `globalThis` alone does nothing. */
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
 * Built rather than written, so the bundler cannot see it. Vite rewrites a literal
 * `import(url)` into a dev-server transform that 500s on an addon.
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
 * The whole surface. Everything here is a message; nothing is a shortcut, and
 * `messaging.servers()` is a promise because the answer lives in the app.
 */
const gryt = {
  /* Annotated, unlike an inferred `string`, because the generated API reference
     reads this file as text and printed `version` with no type beside it. */
  get version(): string {
    return version;
  },
  get theme(): ThemeInfo {
    return { ...theme };
  },
  /**
   * Hear about something. `themeChange` when appearance changes, `cleanup` when
   * this plugin is turned off — the worker is terminated shortly after.
   */
  on(
    event: "themeChange" | "cleanup",
    handler: (payload: ThemeInfo | undefined) => void,
  ): () => void {
    return on(event, handler as Handler);
  },
  /**
   * Say what the person running this is doing. Needs `status`. An empty string
   * clears it, and it rejects rather than resolving quietly when not granted.
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
  processes: {
    /**
     * Which of the programs the person listed are running. Needs `processes`.
     * Their list, not their machine. Empty in a browser and until one is listed.
     */
    running(): Promise<string[]> {
      return call("processes.running", []) as Promise<string[]>;
    },
    /** Hear when that answer changes. Needs `processes`. */
    on(handler: (running: string[]) => void): () => void {
      void call("processes.subscribe", []);
      return on("processes", handler as Handler);
    },
  },
  ui: {
    /**
     * Draw a panel beside the member list. Needs `display`. A title and rows of
     * text, nothing else; calling it again replaces the one panel per plugin.
     */
    panel(panel: { title: string; rows: { label: string; value?: string }[] }): Promise<unknown> {
      return call("ui.panel", [panel]);
    },
    /** Take it down. Needs `display`. */
    clear(): Promise<unknown> {
      return call("ui.clear", []);
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
