/**
 * The typed half of a confirmation. Separate from the component because a check
 * script can import a `.ts` and cannot import a `.tsx`.
 */

/**
 * Whether what somebody typed unlocks the button. An empty `confirmPhrase` means
 * the dialog was not asking, which is not an empty answer satisfying one.
 */
export function phraseMatches(typed: string, confirmPhrase?: string): boolean {
  if (!confirmPhrase || !confirmPhrase.trim()) return true;
  return typed.trim().toLowerCase() === confirmPhrase.trim().toLowerCase();
}
