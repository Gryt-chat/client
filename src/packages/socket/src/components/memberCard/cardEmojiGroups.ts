import type { EmojiPickerGroup } from "@gryt/ui";
import { Sparkle } from "@phosphor-icons/react";
import { createElement } from "react";
import { useMemo, useSyncExternalStore } from "react";

import { getCustomEmojis, onCustomEmojisChange } from "../../utils/emojiData";

/** Custom emoji from the server currently open in the client. */
export function useCardEmojiGroups(serverHost?: string): readonly EmojiPickerGroup[] {
  const custom = useSyncExternalStore(
    onCustomEmojisChange,
    () => getCustomEmojis(serverHost),
  );
  return useMemo(() => {
    if (custom.length === 0) return [];
    return [{
      id: "server",
      label: "This server",
      // Without an icon the picker's category bar draws a dot.
      icon: createElement(Sparkle, { size: 18, weight: "bold" }),
      items: custom.flatMap((emoji) => emoji.url ? [{
        id: `server:${emoji.name}`,
        name: emoji.name,
        keywords: [...emoji.tags, ...emoji.aliases],
        imageUrl: emoji.url,
      }] : []),
    }];
  }, [custom]);
}
