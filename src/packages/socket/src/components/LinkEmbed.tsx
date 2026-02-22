import { Flex } from "@radix-ui/themes";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { MdClose } from "react-icons/md";

import { getServerAccessToken, getServerHttpBase } from "@/common";

const URL_REGEX = /https?:\/\/[^\s<>[\](){}'"`,]+[^\s<>[\](){}'"`,.:;!?)]/gi;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg|bmp|avif)(\?[^\s]*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|ogv)(\?[^\s]*)?$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|flac|aac|m4a|opus)(\?[^\s]*)?$/i;

interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  favicon: string | null;
}

type EmbedType = "image" | "video" | "audio" | "link";

function getEmbedType(url: string): EmbedType {
  if (IMAGE_EXT.test(url)) return "image";
  if (VIDEO_EXT.test(url)) return "video";
  if (AUDIO_EXT.test(url)) return "audio";
  return "link";
}

export function extractUrls(text: string | null): string[] {
  if (!text) return [];
  let cleaned = text.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/`[^`]+`/g, "");
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]+\)/g, "");
  const matches = cleaned.match(URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)];
}

const DISMISSED_KEY = "gryt:dismissed-embeds";

function getDismissedEmbeds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function dismissEmbed(messageId: string, url: string): void {
  const dismissed = getDismissedEmbeds();
  dismissed.add(`${messageId}:${url}`);
  const arr = [...dismissed];
  if (arr.length > 1000) arr.splice(0, arr.length - 1000);
  localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
}

function isEmbedDismissed(messageId: string, url: string): boolean {
  return getDismissedEmbeds().has(`${messageId}:${url}`);
}

const DismissButton = ({ onDismiss }: { onDismiss: () => void }) => (
  <button
    className="link-embed-dismiss"
    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
    title="Remove embed"
  >
    <MdClose size={14} />
  </button>
);

const ImageEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => (
  <div className="link-embed-container">
    <DismissButton onDismiss={onDismiss} />
    <img
      src={url}
      alt="Embedded image"
      className="link-embed-image"
      onClick={() => window.open(url, "_blank")}
    />
  </div>
);

const VideoEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => (
  <div className="link-embed-container">
    <DismissButton onDismiss={onDismiss} />
    <video src={url} controls className="link-embed-video" preload="metadata" />
  </div>
);

const AudioEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => (
  <div className="link-embed-container link-embed-audio-wrap">
    <DismissButton onDismiss={onDismiss} />
    <audio src={url} controls className="link-embed-audio" preload="metadata" />
  </div>
);

const previewCache = new Map<string, LinkPreviewData>();

const LinkPreviewCard = memo(({
  url,
  serverHost,
  onDismiss,
}: {
  url: string;
  serverHost: string;
  onDismiss: () => void;
}) => {
  const [data, setData] = useState<LinkPreviewData | null>(() => previewCache.get(url) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) { setFailed(true); return; }

    const base = getServerHttpBase(serverHost);
    fetch(`${base}/api/link-preview?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json();
      })
      .then((d: LinkPreviewData) => {
        if (cancelled) return;
        previewCache.set(url, d);
        setData(d);
      })
      .catch(() => { if (!cancelled) setFailed(true); });

    return () => { cancelled = true; };
  }, [url, serverHost, data]);

  if (failed || !data || (!data.title && !data.description && !data.image)) return null;

  const hostname = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  })();

  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <a href={url} target="_blank" rel="noopener noreferrer" className="link-embed-card">
        <div className="link-embed-card-accent" />
        <div className="link-embed-card-inner">
          <div className="link-embed-card-body">
            <div className="link-embed-card-site">
              {data.favicon && (
                <img
                  src={data.favicon}
                  alt=""
                  className="link-embed-card-favicon"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              <span className="link-embed-card-hostname">
                {data.siteName || hostname}
              </span>
            </div>
            {data.title && (
              <div className="link-embed-card-title">{data.title}</div>
            )}
            {data.description && (
              <div className="link-embed-card-description">
                {data.description.length > 200 ? data.description.slice(0, 200) + "\u2026" : data.description}
              </div>
            )}
          </div>
          {data.image && (
            <div className="link-embed-card-image-wrap">
              <img
                src={data.image}
                alt={data.title || "Preview"}
                className="link-embed-card-image"
                onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = "none"; }}
              />
            </div>
          )}
        </div>
      </a>
    </div>
  );
});

LinkPreviewCard.displayName = "LinkPreviewCard";

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

  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const u of urls) {
      if (isEmbedDismissed(messageId, u)) set.add(u);
    }
    return set;
  });

  const handleDismiss = useCallback((url: string) => {
    dismissEmbed(messageId, url);
    setDismissed((prev) => new Set(prev).add(url));
  }, [messageId]);

  const visibleUrls = useMemo(() => urls.filter((u) => !dismissed.has(u)), [urls, dismissed]);

  if (visibleUrls.length === 0) return null;

  return (
    <Flex direction="column" gap="2" style={{ marginTop: "4px" }}>
      {visibleUrls.map((url) => {
        const type = getEmbedType(url);
        switch (type) {
          case "image":
            return <ImageEmbed key={url} url={url} onDismiss={() => handleDismiss(url)} />;
          case "video":
            return <VideoEmbed key={url} url={url} onDismiss={() => handleDismiss(url)} />;
          case "audio":
            return <AudioEmbed key={url} url={url} onDismiss={() => handleDismiss(url)} />;
          case "link":
            return <LinkPreviewCard key={url} url={url} serverHost={serverHost} onDismiss={() => handleDismiss(url)} />;
        }
      })}
    </Flex>
  );
});

MessageEmbeds.displayName = "MessageEmbeds";
