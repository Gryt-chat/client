export interface EmojiQuery {
  /** What has been typed after the colon. */
  name: string;
  /** Where the colon is, so a pick knows what to replace. */
  start: number;
}

/**
 * The shortcode being typed just behind the caret, or null. The colon has to start a word,
 * so `host:3000` and `12:30` are not shortcodes. Mobile's `queryAt` uses the same rule.
 */
export function emojiQueryAt(text: string, caret: number): EmojiQuery | null {
  const match = /(^|[\s(]):([a-zA-Z0-9_+-]*)$/.exec(text.slice(0, caret));
  if (!match) return null;

  // More of the name after the caret means an edit in the middle of it.
  if (/^[a-zA-Z0-9_+-]/.test(text.slice(caret))) return null;

  const name = match[2];
  if (name.length < 2) return null;

  return { name, start: caret - name.length - 1 };
}
