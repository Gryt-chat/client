/**
 * What a client does when a server says the session is over.
 *
 * `token:revoked` covers two situations that want opposite answers. Sometimes
 * the server has moved on — its own token counter was rotated, a membership row
 * was rebuilt — and the client can quietly fetch a new token and carry on.
 * Sometimes a person deliberately ended this session, and quietly fetching a
 * new token is the one thing that must not happen: joining a Gryt server takes
 * no password, only the keypair already sitting on this machine, so a client
 * that rejoins by itself signs somebody back in on the device they just signed
 * out of.
 *
 * The recoverable half backs off and eventually stops. A server can send this
 * event as often as it likes, and a client that answers each one straight away
 * is a loop — it burns battery, and it makes the machine sign with its private
 * key on demand. A server with a bug does that as readily as one with a grudge,
 * so neither is worth telling apart here.
 */

/**
 * Reasons where recovering would undo what somebody just asked for.
 *
 * `signed_out_elsewhere` is the push from another device. The version mismatch
 * is the same event arriving through a gate instead — the socket that was
 * offline when it happened, or that reconnected afterwards and presented the
 * token it still had.
 */
const DELIBERATE = new Set(["signed_out_elsewhere", "user_token_version_mismatch"]);

export const FIRST_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 30_000;
export const MAX_RETRIES = 5;

/**
 * How long without a revocation counts as the trouble having passed.
 *
 * A loop hammers within seconds, so anything spaced wider than this is a fresh
 * occurrence rather than a continuation, and gets its own budget. It also caps
 * the long run: whatever a server does, it cannot get this client to sign more
 * than MAX_RETRIES times per quiet period.
 */
export const QUIET_PERIOD_MS = 120_000;

export interface RecoveryState {
  retries: number;
  lastRetryAt: number;
}

export type RecoveryPlan =
  | { act: "retry"; delayMs: number; retry: number }
  | { act: "stop"; because: "deliberate" | "out_of_retries" };

export const idleRecovery = (): RecoveryState => ({ retries: 0, lastRetryAt: 0 });

export function isDeliberateRevocation(reason: string | undefined): boolean {
  return !!reason && DELIBERATE.has(reason);
}

/**
 * Decides what to do about one `token:revoked`, and returns the state the next
 * one should be judged against.
 *
 * Pure, and given the clock rather than reading it, so the backoff can be
 * tested without waiting through it.
 */
export function planRecovery(
  state: RecoveryState,
  reason: string | undefined,
  now: number,
): { plan: RecoveryPlan; state: RecoveryState } {
  if (isDeliberateRevocation(reason)) {
    return { plan: { act: "stop", because: "deliberate" }, state: idleRecovery() };
  }

  const spent = now - state.lastRetryAt >= QUIET_PERIOD_MS ? 0 : state.retries;
  if (spent >= MAX_RETRIES) {
    // The state is left alone on purpose. `lastRetryAt` still marks the last
    // time this client actually did something, so the quiet period is measured
    // from that rather than from the server's most recent shove — otherwise a
    // server that keeps sending this holds the budget shut forever.
    return { plan: { act: "stop", because: "out_of_retries" }, state };
  }

  const retry = spent + 1;
  return {
    plan: {
      act: "retry",
      delayMs: Math.min(FIRST_RETRY_MS * 2 ** spent, MAX_RETRY_MS),
      retry,
    },
    state: { retries: retry, lastRetryAt: now },
  };
}
