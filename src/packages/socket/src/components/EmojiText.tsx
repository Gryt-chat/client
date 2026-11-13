import { EmojiText as UiEmojiText, type EmojiTextProps } from "@gryt/ui";
import { memo } from "react";

import { useCustomEmojiMap } from "../hooks/useCustomEmojiMap";

/** @gryt/ui's EmojiText with this app's custom emoji filled in. */
export const EmojiText = memo((props: Omit<EmojiTextProps, "customEmojis">) => (
  <UiEmojiText {...props} customEmojis={useCustomEmojiMap()} />
));

EmojiText.displayName = "EmojiText";
