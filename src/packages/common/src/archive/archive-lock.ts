/**
 * Exactly one tab does MLS work, because two tabs processing the same group at once
 * corrupt its state. The rest wait in the lock queue and read the archive.
 */

export const MLS_WORKER_LOCK = "gryt-mls-worker";

export interface MlsWorkerClaim {
  /** True while this tab holds the lock and `onAcquire` has been called. */
  readonly held: boolean;
  /** Leave the queue, or hand the lock to the next tab if this one holds it. */
  release(): void;
}

export function claimMlsWorker({
  onAcquire,
  name = MLS_WORKER_LOCK,
  locks = globalThis.navigator?.locks,
}: {
  onAcquire: () => void | Promise<void>;
  name?: string;
  locks?: LockManager;
}): MlsWorkerClaim {
  let held = false;
  let letGo = () => {};
  const hold = new Promise<void>((resolve) => {
    letGo = resolve;
  });

  const claim: MlsWorkerClaim = {
    get held() {
      return held;
    },
    release() {
      abort.abort();
      letGo();
    },
  };

  const run = async () => {
    held = true;
    try {
      await onAcquire();
    } catch (e) {
      console.warn("[Archive] The MLS worker failed to start:", e);
    }
    await hold;
    held = false;
  };

  const abort = new AbortController();
  if (!locks) {
    // No Web Locks means one context anyway: old Node in a test, never a real browser tab.
    void run();
    return claim;
  }

  locks.request(name, { signal: abort.signal }, run).catch((e: unknown) => {
    if ((e as { name?: string })?.name !== "AbortError") console.warn("[Archive] MLS worker lock failed:", e);
  });
  return claim;
}
