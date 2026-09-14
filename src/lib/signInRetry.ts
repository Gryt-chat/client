/** What one quiet try at restoring the session found. */
export type SignInAttempt =
  /** Signed back in. */
  | "signed-in"
  /** Accounts didn't answer usefully. The tokens are kept, so try again later. */
  | "unavailable"
  /** A definite answer: no tokens, a rejected grant, or no session. Nothing to retry. */
  | "signed-out";

/**
 * How long to wait after a failed try: 30s doubling to five minutes, with
 * jitter so every client does not come back at the same instant.
 */
export function retryDelayMs(failures: number): number {
  const base = Math.min(30_000 * 2 ** (failures - 1), 300_000);
  return base * (0.75 + Math.random() * 0.5);
}

export interface SignInRetryOptions {
  attempt: () => Promise<SignInAttempt>;
  /** Called once, with the answer that ended the retry. Not called when stopped. */
  onFinished: (result: Exclude<SignInAttempt, "unavailable">) => void;
  delayMs?: (failures: number) => number;
  /** Runs `run` after `ms` and returns a cancel. A seam for tests. */
  schedule?: (run: () => void, ms: number) => () => void;
}

function scheduleTimeout(run: () => void, ms: number): () => void {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
}

/** Tries now, then backs off until signed in or told no. Returns a stop function. */
export function startSignInRetry({
  attempt,
  onFinished,
  delayMs = retryDelayMs,
  schedule = scheduleTimeout,
}: SignInRetryOptions): () => void {
  let stopped = false;
  let failures = 0;
  let cancel: (() => void) | null = null;

  const run = async () => {
    cancel = null;
    let result: SignInAttempt;
    try {
      result = await attempt();
    } catch (e) {
      console.warn("[Auth:Retry] Sign-in retry threw, treating as unavailable:", e);
      result = "unavailable";
    }
    if (stopped) return;

    if (result !== "unavailable") {
      console.log("[Auth:Retry] Sign-in retry finished:", result);
      onFinished(result);
      return;
    }

    failures += 1;
    const wait = delayMs(failures);
    console.warn(
      `[Auth:Retry] Accounts still not answering (attempt ${failures}) — retrying in ${Math.round(wait / 1000)}s`,
    );
    cancel = schedule(() => void run(), wait);
  };

  void run();

  return () => {
    stopped = true;
    cancel?.();
  };
}
