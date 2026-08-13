import { Tooltip } from "@gryt/ui";
import { nameToEmoji } from "gemoji";
import { memo, useSyncExternalStore } from "react";

import { getCustomEmojis, onCustomEmojisChange } from "../utils/emojiData";

interface EmojiTextProps {
  text: string;
  emojiSize?: number | string;
  disableTooltip?: boolean;
}

/**
 * Lightweight inline renderer that converts :shortcode: patterns to
 * Unicode emojis (via gemoji) or custom emoji <img> tags. Intended for
 * channel names, separator labels, reactions, and other non-markdown
 * contexts where full MarkdownRenderer is overkill.
 */
export const EmojiText = memo(({ text, emojiSize, disableTooltip }: EmojiTextProps) => {
  const customEmojis = useSyncExternalStore(onCustomEmojisChange, getCustomEmojis);
  const customMap = new Map(customEmojis.map((e) => [e.name, e.url]));
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(/:([a-zA-Z0-9_+-]+):/g)) {
    const code = match[1];
    const start = match.index!;
    const emojiId = `:${code}:`;

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    const unicode = nameToEmoji[code];
    if (unicode) {
      const span = (
        <span key={`emoji-${start}`} style={{ cursor: "inherit" }}>
          {unicode}
        </span>
      );
      parts.push(
        disableTooltip ? span : (
          <Tooltip key={`emoji-${start}`} title={emojiId}>
            {span}
          </Tooltip>
        ),
      );
    } else {
      const url = customMap.get(code);
      if (url) {
        const sz = emojiSize ?? "1.4em";
        const cssVal = typeof sz === "number" ? `${sz}px` : sz;
        const img = (
          <img
            key={`emoji-${start}`}
            src={url}
            alt={emojiId}
            data-emoji-name={code}
            className="inline-emoji"
            style={{
              height: cssVal,
              width: "auto",
              verticalAlign: "middle",
              display: "inline",
              objectFit: "contain",
              margin: "0 1px",
              cursor: "inherit",
            }}
          />
        );
        parts.push(
          disableTooltip ? img : (
            <Tooltip key={`emoji-${start}`} title={emojiId}>
              {img}
            </Tooltip>
          ),
        );
      } else {
        parts.push(match[0]);
      }
    }

    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
});

EmojiText.displayName = "EmojiText";
