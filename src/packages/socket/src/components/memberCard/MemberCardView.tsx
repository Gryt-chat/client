import { MemberCard, type MemberCardProps, setCardIconLoader } from "@gryt/ui";
import { useEffect, useState } from "react";

import { useServerManagement } from "../../hooks/useServerManagement";
import { BotTag } from "../BotTag";
import { useCardEmojiGroups } from "./cardEmojiGroups";

// Each Phosphor icon is its own chunk here, so the card is told how to load one.
setCardIconLoader(() => import("./phosphorIcons"));

export type { CardChip } from "@gryt/ui";

export type MemberCardViewProps = Omit<MemberCardProps, "badge" | "emojiGroups"> & {
  isBot?: boolean;
  /** Known for a local file; server files are detected from their response headers. */
  bannerMime?: string | null;
};

type BannerType = "image" | "video";
const bannerTypes = new Map<string, BannerType>();
const typeFromMime = (mime?: string | null): BannerType => mime?.toLowerCase().startsWith("video/") ? "video" : "image";

function useBannerType(url?: string | null, mime?: string | null): BannerType {
  const explicit = mime ? typeFromMime(mime) : null;
  const [type, setType] = useState<BannerType>(() => explicit ?? (url ? bannerTypes.get(url) : undefined) ?? "image");

  useEffect(() => {
    if (!url) { setType("image"); return; }
    if (explicit) { setType(explicit); return; }
    const cached = bannerTypes.get(url);
    if (cached) { setType(cached); return; }
    setType("image");
    const controller = new AbortController();
    void fetch(url, { method: "HEAD", signal: controller.signal })
      .then((response) => {
        if (!response.ok) return;
        const found = typeFromMime(response.headers.get("content-type"));
        bannerTypes.set(url, found);
        setType(found);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [url, explicit]);

  return type;
}

/** The card from @gryt/ui (GRYT-1640), with the app's bot tag beside a bot's name. */
export function MemberCardView({ isBot, bannerMime, ...props }: MemberCardViewProps) {
  const { currentlyViewingServer } = useServerManagement();
  const emojiGroups = useCardEmojiGroups(currentlyViewingServer?.host);
  const bannerType = useBannerType(props.bannerUrl, bannerMime);
  const memberCardProps = { ...props, bannerType };
  return <MemberCard {...memberCardProps} emojiGroups={emojiGroups} badge={isBot ? <BotTag size="small" /> : undefined} />;
}
