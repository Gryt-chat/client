import { useSettings } from "@/settings";

import { preprocessSmileys } from "../utils/remarkEmoji";
import { EmojiText } from "./EmojiText";

/** A reply's preview, with smileys and custom emoji drawn the way the message itself draws them. */
export function ReplyPreviewText({ text }: { text: string }) {
  const { smileyConversion, disabledSmileys } = useSettings();
  return <EmojiText text={smileyConversion ? preprocessSmileys(text, disabledSmileys) : text} emojiSize={14} disableTooltip />;
}
