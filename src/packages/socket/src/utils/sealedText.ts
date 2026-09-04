/**
 * What to draw in place of a message that has not been opened (GRYT-729).
 *
 * Its own file so the wording has a test: `locked` and `broken` mean opposite
 * things and would read identically if either lost its sentence.
 *
 * The same four answers as the mobile app's `sealedText.ts`. Two clients
 * describing one state differently is worse than either wording.
 */
export function sealedPlaceholder(message: {
  sealed?: string | null;
  sealedState?: "opening" | "open" | "locked" | "broken";
}): string | null {
  if (!message.sealed) return null;

  switch (message.sealedState) {
    case "open":
      // It opened. `text` is the message, and this has nothing to say.
      return null;
    case "locked":
      // No wrapped key for us. Sent before we joined the conversation, which is
      // permanent and ordinary — not a failure, and not worth an alarm.
      return "Sent before you joined this conversation.";
    case "broken":
      // A key that is there and does not open. Tampering, or a message from
      // another conversation. Said plainly without naming a cause, because from
      // here the two are the same thing.
      return "This message could not be opened.";
    default:
      // `opening`, and the render between a sealed message arriving and the
      // effect marking it.
      return "Decrypting…";
  }
}
