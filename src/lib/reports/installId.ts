/**
 * A random id for this install of Gryt. **Per install, not per person, and
 * deliberately not derived** — clearing site data gives a new one.
 */

const KEY = "reportInstallId";

export function installId(): string | null {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;

    const fresh = crypto.randomUUID();
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Unwritable storage costs a rate-limit bucket and nothing else. Null rather
    // than a fresh id per call, which would look like a new install each time.
    return null;
  }
}
