import { MemberCard, type MemberCardProps, setCardIconLoader } from "@gryt/ui";

import { useServerManagement } from "../../hooks/useServerManagement";
import { BotTag } from "../BotTag";
import { useCardEmojiGroups } from "./cardEmojiGroups";

// Each Phosphor icon is its own chunk here, so the card is told how to load one.
setCardIconLoader(() => import("./phosphorIcons"));

export type { CardChip } from "@gryt/ui";

export type MemberCardViewProps = Omit<MemberCardProps, "badge" | "emojiGroups"> & { isBot?: boolean };

/** The card from @gryt/ui (GRYT-1640), with the app's bot tag beside a bot's name. */
export function MemberCardView({ isBot, ...props }: MemberCardViewProps) {
  const { currentlyViewingServer } = useServerManagement();
  const emojiGroups = useCardEmojiGroups(currentlyViewingServer?.host);
  return <MemberCard {...props} emojiGroups={emojiGroups} badge={isBot ? <BotTag size="small" /> : undefined} />;
}
