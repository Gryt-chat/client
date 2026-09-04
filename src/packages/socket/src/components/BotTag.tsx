/**
 * The mark that says a bot wrote this, or that a bot is in the room.
 *
 * Rendered from a flag the server derives from the identity itself, never from
 * anything the member controls — a person cannot spell their way into it, and a
 * bot cannot spell its way out.
 *
 * It sits beside the name on every message rather than only in the member list.
 * Somebody deciding whether to act on what a message says is looking at the
 * message, not at a sidebar.
 */
export function BotTag({ size = "normal" }: { size?: "normal" | "small" }) {
  return (
    <span
      // Read out as a word rather than as three letters, for anyone listening
      // rather than looking.
      aria-label="This account is a bot"
      title="A bot. Its permissions were granted by a server admin."
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        fontSize: size === "small" ? "0.58rem" : "0.62rem",
        fontWeight: 700,
        letterSpacing: "0.06em",
        lineHeight: 1,
        padding: size === "small" ? "0.13em 0.3em" : "0.16em 0.36em",
        borderRadius: "var(--gryt-radius-sm, 3px)",
        background: "var(--gryt-neutral-6)",
        color: "var(--gryt-text-muted)",
        border: "1px solid var(--gryt-border)",
        textTransform: "uppercase",
        verticalAlign: "middle",
      }}
    >
      Bot
    </span>
  );
}
