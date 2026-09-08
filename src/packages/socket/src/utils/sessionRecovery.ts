/**
 * What a client does when a server says the session is over. Recovering after a
 * deliberate sign-out would sign somebody back in on the device they left.
 */

/**
 * Reasons where recovering would undo what somebody just asked for.
 * `signed_out_elsewhere` is the push; the version mismatch is it through a gate.
 */
const DELIBERATE = new Set(["signed_out_elsewhere", "user_token_version_mismatch"]);

export const FIRST_RETRY_MS = 1_000;
export const MAX_RETRY_MS = 30_000;
export const MAX_RETRIES = 5;

/**
 * How long without a revocation counts as the trouble having passed. A loop
 * hammers within seconds, so anything wider than this gets its own budget.
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
 * one is judged against. Pure, and given the clock rather than reading it.
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
    // The state is left alone on purpose: `lastRetryAt` marks the last time this
    // client did something, so a server shoving repeatedly cannot hold it shut.
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
