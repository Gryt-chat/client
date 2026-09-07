/**
 * The typed half of a confirmation.
 *
 * Separate from the component because a check script can import a `.ts`
 * and cannot import a `.tsx` -- node strips types but not JSX.
 */

/**
 * Whether what somebody typed unlocks the button.
 *
 * Its own function because it is the whole of the safety here: get it wrong in
 * the permissive direction and the dialog is a plain confirm wearing a text
 * box. An empty `confirmPhrase` means the dialog was not asking, which is not
 * the same as an empty answer satisfying one that was.
 */
export function phraseMatches(typed: string, confirmPhrase?: string): boolean {
  if (!confirmPhrase || !confirmPhrase.trim()) return true;
  return typed.trim().toLowerCase() === confirmPhrase.trim().toLowerCase();
}
