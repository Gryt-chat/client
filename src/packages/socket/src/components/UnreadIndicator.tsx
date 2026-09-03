/**
 * The mark on a conversation that has something waiting in it.
 *
 * Two states rather than one, because they answer different questions. A dot
 * means something happened here; a number means somebody named you, and how
 * many times. On a server with a busy general channel the dot is always lit and
 * stops carrying information — the question worth answering is whether anyone
 * asked you something, and that is the one that used to be invisible.
 *
 * One component for both, used by the channel list and the direct message list.
 * They drew the same eight-pixel dot from two copies of the same inline style,
 * and a mention count added to one of them would have been a channel list that
 * counted and a DM list that did not.
 */
export function UnreadIndicator({
  unread,
  mentions = 0,
}: {
  unread: boolean;
  /** Unseen mentions in this conversation. Zero draws the plain dot. */
  mentions?: number;
}) {
  if (mentions > 0) {
    return (
      <div
        className="absolute flex items-center justify-center"
        style={{
          top: "-4px",
          right: "-4px",
          minWidth: 16,
          height: 16,
          padding: "0 5px",
          borderRadius: "var(--gryt-radius-full)",
          // The same fill as the dot, because a mention should not read as
          // quieter than "something happened here". A step 4 pill measured 1.35:1
          // against the sidebar — the number floated and the pill was invisible.
          backgroundColor: "var(--gryt-accent-9)",
          /*
           * Black or white on that fill, whichever the fill is not.
           *
           * There is no on-accent token in the scale, and the accent is the
           * person's own choice, so neither colour is safe to hardcode: white
           * on a yellow accent is unreadable and black on a navy one is. The
           * multiplication is the standard trick for a branchless decision in
           * CSS — anything above the lightness threshold clamps to 0 and
           * anything below it to 1 — and chroma 0 keeps the result neutral
           * rather than a tinted grey. Measured at 7.6:1 on the default accent.
           */
          color: "oklch(from var(--gryt-accent-9) clamp(0, (0.62 - l) * 1000, 1) 0 h)",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          zIndex: 1,
          pointerEvents: "none",
        }}
      >
        {mentions > 99 ? "99+" : mentions}
      </div>
    );
  }

  if (!unread) return null;

  return (
    <div
      className="absolute"
      style={{
        top: "-2px",
        right: "-2px",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: "var(--gryt-accent-9)",
        zIndex: 1,
        pointerEvents: "none",
      }}
    />
  );
}
