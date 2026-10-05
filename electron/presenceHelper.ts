/**
 * Rich Presence from gryt-helper when it runs (GRYT-1605), since it got to the socket at
 * login; otherwise the in-app socket from discordIpc.ts does the job.
 */

import type { ActivityEvent, Holder, RpcHost, RpcHostOptions, RpcHostState } from "./discordIpc";
import type { ConnectOptions, HelperLink, HelperStatus } from "./helperChannel";

/* ── Helper first, the in-app socket otherwise ───────────────────────── */

export type PresenceVia = "helper" | "app";

export interface PresenceSourceOptions {
  onActivity: (event: ActivityEvent) => void;
  onState: (state: RpcHostState, holder: Holder | null, via: PresenceVia | null) => void;
  /** Everything showing goes, when the source changes and the old one's games with it. */
  onReset: () => void;
  createHost: (options: Pick<RpcHostOptions, "onActivity" | "onState">) => RpcHost;
  /** connectHelper from helperChannel.ts. Passed in, since the tests run this file without a bundler. */
  connect: (options: ConnectOptions) => Promise<HelperLink | null>;
  /** Who has slot 0 while the helper sits on a higher one. Never connects. */
  findHolder: () => Promise<Holder | null>;
  /** While the in-app socket is in use, how often to look for a helper. */
  pollMs?: number;
  /**
   * With the helper turned on, how long start() waits for it before opening the in-app socket.
   * A game that connects to the app in that gap is dropped when the helper takes over (GRYT-1645).
   */
  waitForHelperMs?: number;
}

export interface PresenceSource {
  start(): Promise<void>;
  /** Removes the in-app socket file before returning, like RpcHost.stop(). Leaves a helper running. */
  stop(): Promise<void>;
  /** Stops a running helper too, for turning Rich Presence off. */
  stopAll(): Promise<void>;
  via(): PresenceVia | null;
}

export function createPresenceSource(options: PresenceSourceOptions): PresenceSource {
  const connect = options.connect;
  const pollMs = options.pollMs ?? 5_000;
  let running = false;
  let link: HelperLink | null = null;
  let host: RpcHost | null = null;
  let poll: NodeJS.Timeout | null = null;
  let trying = false;
  let generation = 0;

  const report = async (status: HelperStatus) => {
    if (status.state === "holding" && status.slot === 0) return options.onState("holding", null, "helper");
    const seen = generation;
    const holder = await options.findHolder().catch(() => null);
    if (seen === generation && link) options.onState("yielded", holder, "helper");
  };

  const startHost = () => {
    if (!running || host || link) return;
    host = options.createHost({
      onActivity: options.onActivity,
      onState: (state, holder) => {
        options.onState(state, holder, state === "off" ? null : "app");
        // The holder may be the helper itself, started a moment before the app.
        if (state === "yielded") void tryHelper();
      },
    });
    void host.start();
  };

  const tryHelper = async (): Promise<void> => {
    if (!running || link || trying) return;
    trying = true;
    const pending: ActivityEvent[] = [];
    let active = false;
    const found = await connect({
      onActivity: (event) => (active ? options.onActivity(event) : pending.push(event)),
      onStatus: (status) => {
        if (active) void report(status);
      },
      onClose: () => {
        if (!active || link !== found) return;
        link = null;
        generation++;
        options.onReset();
        startHost();
      },
    }).catch(() => null);
    trying = false;
    if (!found) return;
    if (!running) return found.close();

    // The in-app socket lets go first, so the helper can move down to slot 0.
    const old = host;
    host = null;
    await old?.stop();
    if (!running) return found.close();
    link = found;
    generation++;
    active = true;
    options.onReset();
    for (const event of pending) options.onActivity(event);
    void report(found.status());
  };

  return {
    async start() {
      if (running) return;
      running = true;
      await tryHelper();
      // Launched alongside the app, the helper is often a moment from answering.
      const until = Date.now() + (options.waitForHelperMs ?? 0);
      while (running && !link && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await tryHelper();
      }
      startHost();
      poll = setInterval(() => void tryHelper(), pollMs);
      poll.unref?.();
    },
    async stop() {
      running = false;
      if (poll) clearInterval(poll);
      poll = null;
      generation++;
      const held = host;
      host = null;
      link?.close();
      link = null;
      await held?.stop();
    },
    async stopAll() {
      link?.quit();
      link = null;
      await this.stop();
    },
    via: () => (link ? "helper" : host ? "app" : null),
  };
}
