/**
 * The mark on a conversation that has something waiting in it.
 *
 * Two states rather than one, because they answer different questions. A dot
 * means something happened here; a number means somebody named you, and how
 * many times. On a server with a busy general channel the dot is always lit and
 * stops carrying information.
 *
 * One component for both lists. They drew the same eight-pixel dot from two
 * copies of the same inline style, and a mention count added to one of them
 * would have been a channel list that counted and a DM list that did not.
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
          // The theme's own answer to what reads on the accent, which is what
          // the server rail already writes its own badge in. This computed the
          // same thing from the accent's lightness for a while, which was a
          // clever way of not knowing the token was there.
          color: "var(--gryt-on-accent)",
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
