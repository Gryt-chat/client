import { AlertDialog, Button } from "@gryt/ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  extractUrls,
  getEmbedType,
  isEmbedDismissed,
} from "./embedUtils";
import { LinkPreviewCard } from "./LinkPreviewCard";

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
          switch (type) {
            case "image":
              return <ImageEmbed key={url} url={url} serverHost={serverHost} onDismiss={onDismiss} />;
            case "video":
              return <VideoEmbed key={url} url={url} onDismiss={onDismiss} />;
            case "audio":
              return <AudioEmbed key={url} url={url} onDismiss={onDismiss} />;
            case "youtube":
              return <YouTubeEmbed key={url} url={url} onDismiss={onDismiss} />;
            case "vimeo":
              return <VimeoEmbed key={url} url={url} onDismiss={onDismiss} />;
            case "twitch":
              return <TwitchEmbed key={url} url={url} onDismiss={onDismiss} />;
            case "soundcloud":
              return <SoundCloudEmbed key={url} url={url} onDismiss={onDismiss} />;
            case "spotify":
              return <SpotifyEmbed key={url} url={url} onDismiss={onDismiss} />;
            case "tiktok":
              return <TikTokEmbed key={url} url={url} onDismiss={onDismiss} />;
            case "instagram":
              return <InstagramEmbed key={url} url={url} onDismiss={onDismiss} />;
            case "x":
              return <XEmbed key={url} url={url} serverHost={serverHost} onDismiss={onDismiss} />;
            case "link":
              return <LinkPreviewCard key={url} url={url} serverHost={serverHost} onDismiss={onDismiss} />;
          }
        })}
      </div>

      <AlertDialog.Root open={!!pendingDismissUrl} onOpenChange={(open) => { if (!open) setPendingDismissUrl(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup className="max-w-100">
          <AlertDialog.Title>Remove embed?</AlertDialog.Title>
          <AlertDialog.Description>
            This hides the embed for you. Edit the message to bring it back.
          </AlertDialog.Description>
          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close
              render={
                <Button tone="neutral" size="small">Cancel</Button>
              }
            />
            <AlertDialog.Close
              render={
                <Button tone="danger" size="small" onClick={confirmDismiss}>Remove</Button>
              }
            />
          </div>
        </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
});

MessageEmbeds.displayName = "MessageEmbeds";
