/**
 * Showing an account's 24 words: asked first, and read only once the answer is yes. Only
 * where this device holds the message key, since the words are that key (GRYT-1498).
 */

export type WordsView =
  | { step: "hidden" }
  | { step: "confirming" }
  | { step: "shown"; words: string };

export type WordsAction = "show" | "confirm" | "hide";

export interface WordsContext {
  keyIsHere: boolean;
  readWords(): Promise<string>;
}

export const HIDDEN: WordsView = { step: "hidden" };

/** The view after `action`. **The words are read on "confirm" from "confirming" and nowhere else.** */
export async function nextWordsView(
  view: WordsView,
  action: WordsAction,
  { keyIsHere, readWords }: WordsContext,
): Promise<WordsView> {
  if (action === "hide" || !keyIsHere) return HIDDEN;
  if (action === "show") return view.step === "shown" ? view : { step: "confirming" };
  if (view.step !== "confirming") return view;
  return { step: "shown", words: await readWords() };
}
