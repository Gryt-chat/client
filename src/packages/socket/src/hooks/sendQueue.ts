/* Getting a send to the server through drops and restarts. Pure, so
   scripts/check-send-queue.mjs can drive it with a fake socket and clock. */

/** How long a send waits for its `chat:new` before it goes again under the same nonce. */
export const ACK_TIMEOUT_MS = 10_000;
/** How long a send keeps trying before its row fails and the text goes back. */
export const GIVE_UP_AFTER_MS = 5 * 60_000;
/** A connection that has said nothing about who it is by now is sent to anyway; the echo decides. */
export const RESTORE_GRACE_MS = 5_000;

/** The slice of a socket.io client the queue touches. */
export interface QueueSocket {
  /** socket.io sets this. Absent on a stand-in, which is treated as connected. */
  connected?: boolean;
  on: (event: string, cb: (payload: never) => void) => void;
  off: (event: string, cb: (payload: never) => void) => void;
}

/** Whether the send went out, or has to wait for the connection, or can never go. */
export type EmitResult = "sent" | "offline" | "failed";

export interface SendQueueOptions {
  /** Puts one send on the wire, built fresh each time: a new token, sealed again. */
  emit: (nonce: string) => Promise<EmitResult>;
  /** Nothing confirmed it before the cap, or it could not be built. The row fails. */
  onGiveUp: (nonce: string) => void;
  /** It is waiting for the connection, or it is not any more. For the row's label. */
  onWaiting?: (nonce: string, waiting: boolean) => void;
  ackTimeoutMs?: number;
  giveUpAfterMs?: number;
  restoreGraceMs?: number;
  timers?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (id: unknown) => void;
  };
}

interface Entry {
  /** `held` is a refused send waiting out the server's wait before its one retry. */
  state: "waiting" | "sending" | "sent" | "held";
  /** Counts attempts, so an emit that resolves after a newer one started is ignored. */
  attempt: number;
  /** A send made during a flush holds back the next one until it lands or times out. */
  blocking: boolean;
  ackTimer?: unknown;
  giveUpTimer: unknown;
}

/**
 * Sends keyed by nonce, in the order they were made. One waits while the socket is
 * down or not yet restored, goes again when an echo is overdue, and fails at the cap.
 */
export class SendQueue {
  private entries = new Map<string, Entry>();
  /** Connected, and the server knows who this socket is. */
  private ready: boolean;
  /** Draining what built up while not ready, one at a time so it lands in order. */
  private flushing = false;
  private readonly options: SendQueueOptions;
  private readonly timers: NonNullable<SendQueueOptions["timers"]>;
  private readonly unsubscribe: () => void;
  private graceTimer: unknown;

  // No parameter properties: scripts/check-send-queue.mjs loads this through strip-types.
  constructor(socket: QueueSocket, options: SendQueueOptions) {
    this.options = options;
    this.timers = options.timers ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    };
    this.ready = socket.connected !== false;

    const onDisconnect = () => this.lost();
    const onConnect = () => {
      this.stopGrace();
      this.graceTimer = this.timers.setTimeout(() => this.restored(), options.restoreGraceMs ?? RESTORE_GRACE_MS);
    };
    // Details without an error go only to a restored socket. A refresh also names it, and can beat the restore.
    const onDetails = (data: { error?: unknown } | null) => {
      if (data && typeof data === "object" && !data.error) this.restored();
    };
    const onRefreshed = () => this.restored();
    const onNew = (msg: { nonce?: unknown } | null) => {
      if (msg && typeof msg.nonce === "string") this.settle(msg.nonce);
    };
    const listeners: [string, (payload: never) => void][] = [
      ["disconnect", onDisconnect],
      ["connect", onConnect],
      ["server:details", onDetails as (p: never) => void],
      ["token:refreshed", onRefreshed],
      ["chat:new", onNew as (p: never) => void],
    ];
    for (const [event, cb] of listeners) socket.on(event, cb);
    this.unsubscribe = () => {
      for (const [event, cb] of listeners) socket.off(event, cb);
    };
  }

  has(nonce: string): boolean {
    return this.entries.has(nonce);
  }

  /** A new send. It goes now if it can, and waits its turn if it cannot. */
  add(nonce: string): void {
    if (this.entries.has(nonce)) return;
    const giveUpTimer = this.timers.setTimeout(
      () => this.giveUp(nonce),
      this.options.giveUpAfterMs ?? GIVE_UP_AFTER_MS,
    );
    this.entries.set(nonce, { state: "waiting", attempt: 0, blocking: false, giveUpTimer });
    if (!this.ready) this.options.onWaiting?.(nonce, true);
    this.pump();
  }

  /** Confirmed, or refused for good by the server. Either way nothing more goes. */
  settle(nonce: string): void {
    const entry = this.entries.get(nonce);
    if (!entry) return;
    this.clear(entry);
    this.entries.delete(nonce);
    this.pump();
  }

  /** Refused with a retry to come: nothing goes on its own until `resend`. */
  hold(nonce: string): void {
    const entry = this.entries.get(nonce);
    if (!entry) return;
    this.stopWaitingForEcho(entry);
    entry.state = "held";
    entry.attempt++;
    this.pump();
  }

  /** A refusal's one automatic retry. Now if the socket is ready, or with the rest when it is. */
  resend(nonce: string): void {
    const entry = this.entries.get(nonce);
    if (!entry) return;
    this.stopWaitingForEcho(entry);
    entry.state = "waiting";
    if (this.ready) this.send(nonce, entry);
    else this.options.onWaiting?.(nonce, true);
  }

  /** Every send still here fails: the socket it was for is going away. */
  dispose(): void {
    this.unsubscribe();
    this.stopGrace();
    for (const nonce of [...this.entries.keys()]) this.giveUp(nonce);
  }

  private lost(): void {
    this.stopGrace();
    this.ready = false;
    this.flushing = false;
    for (const [nonce, entry] of this.entries) {
      if (entry.state === "waiting" || entry.state === "held") continue;
      // What was on the wire may never have arrived. The nonce makes a second copy harmless.
      this.stopWaitingForEcho(entry);
      entry.state = "waiting";
      entry.attempt++;
      this.options.onWaiting?.(nonce, true);
    }
  }

  private restored(): void {
    this.stopGrace();
    if (this.ready) return;
    this.ready = true;
    this.flushing = true;
    this.pump();
  }

  private pump(): void {
    if (!this.ready) return;
    for (const [nonce, entry] of this.entries) {
      if (this.flushing && entry.blocking) return;
      if (entry.state !== "waiting") continue;
      this.send(nonce, entry);
      if (this.flushing) return;
    }
    this.flushing = false;
  }

  private send(nonce: string, entry: Entry): void {
    const attempt = ++entry.attempt;
    entry.state = "sending";
    entry.blocking = this.flushing;
    this.options.onWaiting?.(nonce, false);
    void this.options
      .emit(nonce)
      .catch((): EmitResult => "failed")
      .then((result) => {
        if (this.entries.get(nonce) !== entry || entry.attempt !== attempt) return;
        if (result === "failed") return this.giveUp(nonce);
        if (result === "offline") {
          entry.state = "waiting";
          entry.blocking = false;
          this.options.onWaiting?.(nonce, true);
          return;
        }
        entry.state = "sent";
        entry.ackTimer = this.timers.setTimeout(
          () => this.overdue(nonce, entry),
          this.options.ackTimeoutMs ?? ACK_TIMEOUT_MS,
        );
      });
  }

  /** No echo in time. It goes again, and stops holding up the sends behind it. */
  private overdue(nonce: string, entry: Entry): void {
    if (this.entries.get(nonce) !== entry) return;
    entry.ackTimer = undefined;
    entry.state = "waiting";
    const wasFlushing = this.flushing;
    this.flushing = false;
    if (this.ready) this.send(nonce, entry);
    this.flushing = wasFlushing;
    this.pump();
  }

  private stopGrace(): void {
    if (this.graceTimer !== undefined) this.timers.clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
  }

  private stopWaitingForEcho(entry: Entry): void {
    if (entry.ackTimer !== undefined) this.timers.clearTimeout(entry.ackTimer);
    entry.ackTimer = undefined;
    entry.blocking = false;
  }

  private giveUp(nonce: string): void {
    const entry = this.entries.get(nonce);
    if (!entry) return;
    this.clear(entry);
    this.entries.delete(nonce);
    this.options.onGiveUp(nonce);
    this.pump();
  }

  private clear(entry: Entry): void {
    this.stopWaitingForEcho(entry);
    this.timers.clearTimeout(entry.giveUpTimer);
  }
}
