import {  } from "@gryt/ui";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSettings } from "@/settings/src/hooks/useSettings";

import { ConfirmDialog } from "./ConfirmDialog";
import { EmbedConsent, type EmbedProvider } from "./EmbedConsent";
import {
  AudioEmbed,
  ImageEmbed,
  InstagramEmbed,
  SoundCloudEmbed,
  SpotifyEmbed,
  TikTokEmbed,
  TwitchEmbed,
  VideoEmbed,
  VimeoEmbed,
  XEmbed,
  YouTubeEmbed,
} from "./EmbedRenderers";
import {
  clearDismissedForMessage,
  dismissEmbed,
  type EmbedType,
  extractUrls,
  getEmbedType,
  isEmbedDismissed,
} from "./embedUtils";
import { LinkPreviewCard } from "./LinkPreviewCard";

/* The embeds that run another company's JavaScript, so the only ones held back.
   `link` is unfurled by our server; image, video and audio are files. */
const THIRD_PARTY: Partial<Record<EmbedType, EmbedProvider>> = {
  youtube: { name: "YouTube video", host: "youtube-nocookie.com" },
  vimeo: { name: "Vimeo video", host: "player.vimeo.com" },
  twitch: { name: "Twitch", host: "twitch.tv" },
  soundcloud: { name: "SoundCloud track", host: "soundcloud.com" },
  spotify: { name: "Spotify", host: "open.spotify.com" },
  tiktok: { name: "TikTok", host: "tiktok.com" },
  instagram: { name: "Instagram post", host: "instagram.com" },
  x: { name: "Post on X", host: "platform.twitter.com" },
};

/* Per embed and not remembered: agreeing to one track is not agreeing to a
   week of them. Settings → Chat turns the asking off. */
function AskFirst({
  provider,
  onDismiss,
  children,
}: {
  provider: EmbedProvider;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const { autoLoadEmbeds } = useSettings();
  const [loaded, setLoaded] = useState(false);

  if (autoLoadEmbeds || loaded) return <>{children}</>;

  return (
    <EmbedConsent provider={provider} onLoad={() => setLoaded(true)} onDismiss={onDismiss} />
  );
}


/** The embed itself, once there is nothing left to ask. */
function renderEmbed(
  type: EmbedType,
  url: string,
  serverHost: string,
  onDismiss: () => void,
) {
  switch (type) {
    case "image":
      return <ImageEmbed url={url} serverHost={serverHost} onDismiss={onDismiss} />;
    case "video":
      return <VideoEmbed url={url} onDismiss={onDismiss} />;
    case "audio":
      return <AudioEmbed url={url} onDismiss={onDismiss} />;
    case "youtube":
      return <YouTubeEmbed url={url} onDismiss={onDismiss} />;
    case "vimeo":
      return <VimeoEmbed url={url} onDismiss={onDismiss} />;
    case "twitch":
      return <TwitchEmbed url={url} onDismiss={onDismiss} />;
    case "soundcloud":
      return <SoundCloudEmbed url={url} onDismiss={onDismiss} />;
    case "spotify":
      return <SpotifyEmbed url={url} onDismiss={onDismiss} />;
    case "tiktok":
      return <TikTokEmbed url={url} onDismiss={onDismiss} />;
    case "instagram":
      return <InstagramEmbed url={url} onDismiss={onDismiss} />;
    case "x":
      return <XEmbed url={url} serverHost={serverHost} onDismiss={onDismiss} />;
    case "link":
      return <LinkPreviewCard url={url} serverHost={serverHost} onDismiss={onDismiss} />;
  }
}

export const MessageEmbeds = memo(({
  messageId,
  text,
  serverHost,
}: {
  messageId: string;
  text: string | null;
  serverHost: string;
}) => {
  const urls = useMemo(() => extractUrls(text), [text]);
  const prevTextRef = useRef(text);

  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const u of urls) {
      if (isEmbedDismissed(messageId, u)) set.add(u);
    }
    return set;
  });

  useEffect(() => {
    if (prevTextRef.current !== text) {
      prevTextRef.current = text;
      clearDismissedForMessage(messageId);
      setDismissed(new Set());
    }
  }, [text, messageId]);

  const [pendingDismissUrl, setPendingDismissUrl] = useState<string | null>(null);

  const confirmDismiss = useCallback(() => {
    if (!pendingDismissUrl) return;
    dismissEmbed(messageId, pendingDismissUrl);
    setDismissed((prev) => new Set(prev).add(pendingDismissUrl));
    setPendingDismissUrl(null);
  }, [messageId, pendingDismissUrl]);

  const visibleUrls = useMemo(() => urls.filter((u) => !dismissed.has(u)), [urls, dismissed]);

  if (visibleUrls.length === 0) return null;

  return (
    <>
      <div className="flex flex-col gap-2" style={{ marginTop: "4px" }}>
        {visibleUrls.map((url) => {
          const onDismiss = () => setPendingDismissUrl(url);
          const type = getEmbedType(url);

          /* Another company's page: drawn as a placeholder until asked for. */
          const provider = THIRD_PARTY[type];
          if (provider) {
            return (
              <AskFirst key={url} provider={provider} onDismiss={onDismiss}>
                {renderEmbed(type, url, serverHost, onDismiss)}
              </AskFirst>
            );
          }

          return <Fragment key={url}>{renderEmbed(type, url, serverHost, onDismiss)}</Fragment>;
        })}
      </div>

      <ConfirmDialog
        open={!!pendingDismissUrl}
        onOpenChange={(open) => { if (!open) setPendingDismissUrl(null); }}
        title="Remove embed?"
        description="This hides the embed for you. Edit the message to bring it back."
        confirmLabel="Remove"
        width="25rem"
        onConfirm={confirmDismiss}
      />
    </>
  );
});

MessageEmbeds.displayName = "MessageEmbeds";
