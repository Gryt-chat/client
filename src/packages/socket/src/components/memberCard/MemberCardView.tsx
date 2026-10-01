import { MemberCard, type MemberCardProps, setCardIconLoader } from "@gryt/ui";

import { BotTag } from "../BotTag";
import { useCardEmojiGroups } from "./cardEmojiGroups";

// Each Phosphor icon is its own chunk here, so the card is told how to load one.
setCardIconLoader(() => import("./phosphorIcons"));

export type { CardChip } from "@gryt/ui";

export type MemberCardViewProps = Omit<MemberCardProps, "badge"> & { isBot?: boolean };

/** The card from @gryt/ui (GRYT-1640), with the app's bot tag beside a bot's name. */
export function MemberCardView({ isBot, ...props }: MemberCardViewProps) {
  const emojiGroups = useCardEmojiGroups();
  return <MemberCard {...props} emojiGroups={emojiGroups} badge={isBot ? <BotTag size="small" /> : undefined} />;
}
