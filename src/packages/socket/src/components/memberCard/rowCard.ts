import { cardVars, seedFromId, usePatternAssets } from "@gryt/ui";
import { type CSSProperties, useMemo } from "react";

import { generatedAvatarColor, getUploadsFileUrl, useTheme } from "@/common";

import { cardProfileFor } from "../../lib/memberCard/generatedCard";
import type { MemberInfo } from "../MemberSidebar";
import { useCardEmojiGroups } from "./cardEmojiGroups";

const FALLBACK_OWL = "#7c5cff";

/** How the row draws the card: its banner picture, the card coloured whole, or the banner's colour and pattern. */
export type RowCardKind = "img" | "fc" | "fc-cover" | "banner";

/**
 * A member's card as the background of their row in the member list (GRYT-1726).
 * The same variables the card itself draws from, so the two never disagree.
 */
export function useRowCard(member: MemberInfo, serverHost: string): { kind: RowCardKind; style: CSSProperties } {
  const { resolvedAppearance } = useTheme();
  const emojiGroups = useCardEmojiGroups(serverHost);
  const profile = useMemo(
    () => cardProfileFor(member, member.nickname),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [member.cardStyle, member.nickname],
  );
  const owlHex = generatedAvatarColor(member.nickname, member.avatarWorn) ?? member.avatarColor ?? FALLBACK_OWL;
  const assets = usePatternAssets(profile.cardStyle, { nickname: member.nickname, worn: member.avatarWorn }, emojiGroups);
  const { attrs, vars } = useMemo(
    () => cardVars(profile.cardStyle, owlHex, { appearance: resolvedAppearance, seed: seedFromId(member.serverUserId), ...assets }),
    [profile.cardStyle, owlHex, resolvedAppearance, member.serverUserId, assets],
  );
  const style = { ...vars } as CSSProperties & Record<string, string>;
  const picture = member.bannerFileId && !member.bannerVideo ? getUploadsFileUrl(serverHost, member.bannerFileId, { thumb: true }) : null;
  let kind: RowCardKind = "banner";
  if (attrs["data-fc"]) kind = attrs["data-cover"] === "card" ? "fc-cover" : "fc";
  else if (picture) {
    kind = "img";
    style["--img"] = `url("${picture.replace(/["\\]/g, "")}")`;
  }
  return { kind, style };
}
