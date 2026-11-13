import { useMemo, useSyncExternalStore } from "react";

import { getCustomEmojis, onCustomEmojisChange } from "../utils/emojiData";

/** The server's own emoji as @gryt/ui's EmojiText wants them, name to picture URL. */
export function useCustomEmojiMap(): ReadonlyMap<string, string> {
  const customEmojis = useSyncExternalStore(onCustomEmojisChange, getCustomEmojis);
  return useMemo(() => new Map(customEmojis.flatMap((e) => (e.url ? [[e.name, e.url] as const] : []))), [customEmojis]);
}
