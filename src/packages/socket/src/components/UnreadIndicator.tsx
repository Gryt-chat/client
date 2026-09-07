import { Badge } from "@gryt/ui";

/**
 * The count on a conversation that has something waiting in it.
 *
 * It used to be a dot, and a dot only ever said "something happened here" —
 * which on a server with a busy general channel is true all day and stops
 * carrying information. The number is how much.
 *
 * Two counts feed it and they are not the same thing. Unread is every message
 * that arrived and nobody read; mentions are the ones that named you, and only
 * those are stored by the server. So a window that has just connected can know
 * about a mention and not about the messages around it — the unread count is
 * counted from the connection, `mentions:list` answers the whole history. Where
 * unread knows nothing the mention count is what there is to show.
 *
 * Tone carries the difference the number cannot: primary when you were named,
 * neutral when it is only messages. One accent badge per row would make a busy
 * channel look exactly as urgent as one that asked for you.
 *
 * Inline rather than pinned to a corner. It sat at the row's top-right at
 * `-4px, -4px`, so it hung off the row and lined up with nothing; in a list it
 * has to sit at the end of the row and centre with the name.
 */
export function UnreadIndicator({
  unread,
  mentions = 0,
}: {
  /** Unread messages in this conversation. */
  unread: number;
  /** Unseen mentions in it, which are a subset of them. */
  mentions?: number;
}) {
  const count = unread || mentions;
  if (count <= 0) return null;

  const title =
    mentions > 0
      ? `${count} unread, ${mentions} naming you`
      : `${count} unread`;

  return (
    <Badge
      badgeContent={count}
      tone={mentions > 0 ? "primary" : "neutral"}
      title={title}
      className="shrink-0"
    />
  );
}
