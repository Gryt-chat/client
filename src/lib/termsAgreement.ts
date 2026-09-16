export const TERMS_URL = "https://gryt.chat/terms";
export const GUIDELINES_URL = "https://gryt.chat/community-guidelines";

/* The newer of the two pages' "Last updated" dates. Moving it asks everybody again,
   so move it when a change to either page should. */
export const TERMS_VERSION = "2026-09-03";

export const TERMS_STORAGE_KEY = "gryt.termsAgreement";

export interface TermsAgreement {
  version: string;
  agreedAt: string;
}

export interface TermsStorage {
  read: () => string | null | Promise<string | null>;
  write: (value: string) => void | Promise<void>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** What storage held, or null when nothing in it is an agreement. */
export function parseAgreement(raw: string | null | undefined): TermsAgreement | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { version, agreedAt } = value as Record<string, unknown>;
  if (typeof version !== "string" || !DAY.test(version)) return null;
  if (typeof agreedAt !== "string") return null;
  return { version, agreedAt };
}

/** Agreeing to newer terms covers older ones, so a downgrade doesn't ask twice. */
export function coversTerms(agreement: TermsAgreement | null, version: string = TERMS_VERSION): boolean {
  return agreement !== null && agreement.version >= version;
}

export function agreementAt(now: Date, version: string = TERMS_VERSION): TermsAgreement {
  return { version, agreedAt: now.toISOString() };
}

export interface TermsGate {
  /** Runs `post` once this device has agreed: now, or after the person presses Agree. */
  postAfterAgreeing: (post: () => void) => void;
  agree: () => void;
  decline: () => void;
  /** Reads storage ahead of the first post, so that one doesn't wait for it. */
  load: () => void;
  asking: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export function createTermsGate(
  storage: TermsStorage,
  version: string = TERMS_VERSION,
  now: () => Date = () => new Date(),
): TermsGate {
  let agreed = false;
  let queued: (() => void) | null = null;
  let asked: (() => void) | null = null;
  let reading = false;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const settle = (raw: string | null) => {
    if (coversTerms(parseAgreement(raw), version)) agreed = true;
  };

  const flush = () => {
    const post = queued;
    queued = null;
    if (!post) return;
    if (agreed) {
      post();
      return;
    }
    asked = post;
    emit();
  };

  // One read at a time, and only the newest post waits on it: two taps must not send twice.
  const refresh = () => {
    if (reading) return;
    let raw: string | null | Promise<string | null>;
    try {
      raw = storage.read();
    } catch {
      raw = null;
    }
    if (raw === null || typeof raw === "string") {
      settle(raw);
      flush();
      return;
    }
    reading = true;
    raw
      .then(settle, () => undefined)
      .then(() => {
        reading = false;
        flush();
      });
  };

  return {
    postAfterAgreeing(post) {
      if (agreed) {
        post();
        return;
      }
      queued = post;
      refresh();
    },
    agree() {
      agreed = true;
      const post = asked;
      asked = null;
      emit();
      try {
        void Promise.resolve(storage.write(JSON.stringify(agreementAt(now(), version)))).catch(() => undefined);
      } catch {
        // Holds until the app restarts, and then it asks again.
      }
      post?.();
    },
    decline() {
      if (!asked) return;
      asked = null;
      emit();
    },
    load() {
      if (!agreed) refresh();
    },
    asking: () => asked !== null,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
