import { MemberCard, type MemberCardProps, setCardIconLoader } from "@gryt/ui";

import { BotTag } from "../BotTag";
import { NameTag } from "../NameTag";
import { useCardEmojiGroups } from "./cardEmojiGroups";

// Each Phosphor icon is its own chunk here, so the card is told how to load one.
setCardIconLoader(() => import("./phosphorIcons"));

export type { CardChip } from "@gryt/ui";

export type MemberCardViewProps = Omit<MemberCardProps, "badge" | "emojiGroups"> & {
  isBot?: boolean;
  /** The #1 or #2 a name somebody else here also uses gets (GRYT-1674). */
  nameTag?: string;
};

/** The card from @gryt/ui (GRYT-1640), with the name's number and the app's bot tag beside it. */
export function MemberCardView({ isBot, nameTag, ...props }: MemberCardViewProps) {
  const emojiGroups = useCardEmojiGroups();
  const badge =
    isBot || nameTag ? (
      <>
        {/* The card's own muted ink, so it reads on a card coloured whole. */}
        <NameTag tag={nameTag} color="var(--gryt-muted)" />
        {isBot && <BotTag size="small" />}
      </>
    ) : undefined;
  return <MemberCard {...props} emojiGroups={emojiGroups} badge={badge} />;
}
