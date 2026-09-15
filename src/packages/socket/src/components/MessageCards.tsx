import { WebhookCard } from "@gryt/ui";
import { memo, type SyntheticEvent, useCallback } from "react";

import { useStableFileUrl } from "../hooks/useStableFileUrl";
import type { CustomEmojiEntry } from "../utils/remarkEmoji";
import { toWebhookCardData } from "../utils/webhookCards";
import type { StoredWebhookCard } from "./chatUtils";
import { MarkdownRenderer } from "./MarkdownRenderer";
import type { MemberInfo } from "./MemberSidebar";

interface MessageCardsProps {
  cards: StoredWebhookCard[];
  serverHost: string;
  customEmojiList: CustomEmojiEntry[];
  memberNicknames: string[];
  memberList?: Record<string, MemberInfo>;
  smileyConversion: boolean;
  disabledSmileys: ReadonlySet<string>;
  onLightboxOpen: (src: string, alt?: string) => void;
}

/** The cards a webhook posted, in order (GRYT-1186). */
export const MessageCards = memo(function MessageCards({ cards, ...rest }: MessageCardsProps) {
  return (
    <div className="flex flex-col gap-2" style={{ marginTop: 4 }}>
      {cards.map((card, index) => (
        <MessageCard key={index} card={card} {...rest} />
      ))}
    </div>
  );
});

/** One card. Its own component so each picture holds its URL across a file token refresh. */
function MessageCard({
  card,
  serverHost,
  customEmojiList,
  memberNicknames,
  memberList,
  smileyConversion,
  disabledSmileys,
  onLightboxOpen,
}: Omit<MessageCardsProps, "cards"> & { card: StoredWebhookCard }) {
  const [authorIcon, refreshAuthorIcon] = useStableFileUrl(serverHost, card.author?.icon_file_id ?? "", true);
  const [footerIcon, refreshFooterIcon] = useStableFileUrl(serverHost, card.footer?.icon_file_id ?? "", true);
  const [thumbnail, refreshThumbnail] = useStableFileUrl(serverHost, card.thumbnail_file_id ?? "");
  const [image, refreshImage] = useStableFileUrl(serverHost, card.image_file_id ?? "");

  const data = toWebhookCardData(card, (fileId, kind) => {
    if (kind === "icon") return fileId === card.author?.icon_file_id ? authorIcon : footerIcon;
    return fileId === card.image_file_id ? image : thumbnail;
  });

  // Both a token that expired and a real failure land here. A refresh with the same token does nothing.
  const onError = useCallback((event: SyntheticEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLImageElement)) return;
    refreshAuthorIcon();
    refreshFooterIcon();
    refreshThumbnail();
    refreshImage();
  }, [refreshAuthorIcon, refreshFooterIcon, refreshThumbnail, refreshImage]);

  // Mentions draw here but never notify: that is decided from `text` alone, in mentionsViewer.
  const renderMarkdown = useCallback((text: string) => (
    <MarkdownRenderer
      content={text}
      customEmojis={customEmojiList}
      memberNicknames={memberNicknames}
      mentionMembersById={memberList}
      serverHost={serverHost}
      smileyConversion={smileyConversion}
      disabledSmileys={disabledSmileys}
    />
  ), [customEmojiList, memberNicknames, memberList, serverHost, smileyConversion, disabledSmileys]);

  return (
    <WebhookCard
      card={data}
      renderMarkdown={renderMarkdown}
      onPressImage={(src) => onLightboxOpen(src, card.title || "Image")}
      onError={onError}
    />
  );
}
