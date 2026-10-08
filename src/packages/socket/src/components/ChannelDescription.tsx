import { EmojiText } from "./EmojiText";

/** What a channel is for, beside its name in the header. One line; the full text is in the tooltip. */
export function ChannelDescription({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <span
      className="min-w-0 truncate text-sm"
      data-gryt="channel-description"
      title={text}
      style={{ color: "var(--gryt-neutral-11)", paddingLeft: 10, marginLeft: 2, borderLeft: "1px solid var(--gryt-neutral-6)" }}
    >
      <EmojiText text={text} />
    </span>
  );
}
