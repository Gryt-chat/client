/**
 * A random id for this install of Gryt.
 *
 * **Per install, not per person, and deliberately not derived from anything.**
 * The service counts rate limits against it and uses it to tie one person's
 * reports together, which is worth having — a second report saying "still
 * happening" is only useful if you can see it is the same reporter. Deriving it
 * from the identity key would do the same job and would also link every report
 * to the identity that joins servers, which is a thing the guest design spends
 * a lot of effort keeping separate.
 *
 * Clearing site data gives a new one. That is correct: it is an install id.
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
    // Unwritable storage costs a rate-limit bucket and nothing else. Null
    // rather than a fresh id every call, which would look like a new install
    // on every report.
    return null;
  }
}
