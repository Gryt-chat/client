import { Badge } from "@gryt/ui";

/**
 * The count on a conversation with something waiting. Unread is counted from the
 * connection; mentions come from the server, so one can know without the other.
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
      /* Unread for anything waiting, accent for a message that named you.
         Its own token, so a theme can move it and danger stays destructive. */
      tone={mentions > 0 ? "primary" : "unread"}
      title={title}
      className="shrink-0"
    />
  );
}
