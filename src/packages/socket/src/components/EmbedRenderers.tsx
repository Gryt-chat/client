import { Skeleton, VideoPlayer } from "@gryt/ui";
import { useEffect, useRef, useState } from "react";

import { getServerAccessToken, getServerHttpBase, useTheme } from "@/common";
import { useSettings } from "@/settings/src/hooks/useSettings";

import { PiX } from "../../../../lib/icons";
import {
  getInstagramEmbedSrc,
  getSpotifyEmbed,
  getTikTokVideoId,
  getTwitchEmbed,
  getVimeoVideoId,
  getYouTubeVideoId,
  imageEmbedSizeCache,
  parseRemoteImageMetadata,
} from "./embedUtils";

export const DismissButton = ({ onDismiss }: { onDismiss: () => void }) => (
  <button
    className="link-embed-dismiss"
    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
    title="Remove embed"
  >
    <PiX size={14} />
  </button>
);

export const ImageEmbed = ({ url, serverHost, onDismiss }: { url: string; serverHost: string; onDismiss: () => void }) => {
  const [cached, setCached] = useState(() => imageEmbedSizeCache.get(url));

  useEffect(() => {
    setCached(imageEmbedSizeCache.get(url));
  }, [url]);

  useEffect(() => {
    if (cached) return;
    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) return;
    const base = getServerHttpBase(serverHost);
    let cancelled = false;
    fetch(`${base}/api/media/metadata?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("metadata_failed"))))
      .then((j: unknown) => {
        if (cancelled) return;
        const meta = parseRemoteImageMetadata(j);
        if (!meta?.width || !meta.height) return;
        imageEmbedSizeCache.set(url, { width: meta.width, height: meta.height });
        setCached({ width: meta.width, height: meta.height });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cached, serverHost, url]);

  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <img
        src={url}
        alt="Embedded image"
        className="link-embed-image"
        width={cached?.width}
        height={cached?.height}
        loading="lazy"
        decoding="async"
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            imageEmbedSizeCache.set(url, { width: img.naturalWidth, height: img.naturalHeight });
          }
        }}
        onClick={() => window.open(url, "_blank")}
      />
    </div>
  );
};

export const VideoEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => {
  const { chatMediaVolume, setChatMediaVolume } = useSettings();
  return (
    <div className="link-embed-container link-embed-video">
      <DismissButton onDismiss={onDismiss} />
      <VideoPlayer src={url} volume={chatMediaVolume} onVolumeChange={setChatMediaVolume} />
    </div>
  );
};

export const TwitchEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => {
  const embed = getTwitchEmbed(url);
  if (!embed) return null;
  const parent = (() => {
    try {
      const h = window.location.hostname;
      if (h === "127.0.0.1" || h === "localhost") return "localhost";
      return h || "localhost";
    } catch { return "localhost"; }
  })();

  const src = (() => {
    if (embed.kind === "clip") {
      const u = new URL("https://clips.twitch.tv/embed");
      u.searchParams.set("clip", embed.value);
      u.searchParams.set("parent", parent);
      u.searchParams.set("autoplay", "false");
      u.searchParams.set("muted", "true");
      return u.toString();
    }
    const u = new URL("https://player.twitch.tv/");
    if (embed.kind === "video") {
      u.searchParams.set("video", embed.value);
    } else {
      u.searchParams.set("channel", embed.value);
    }
    u.searchParams.set("parent", parent);
    u.searchParams.set("autoplay", "false");
    u.searchParams.set("muted", "true");
    return u.toString();
  })();

  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <iframe
        className="link-embed-iframe"
        src={src}
        title="Twitch"
        loading="lazy"
        allow="autoplay; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
};

export const SoundCloudEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => {
  const src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&auto_play=false&hide_related=true&show_comments=false&show_reposts=false&visual=false`;
  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <iframe
        className="link-embed-iframe-soundcloud"
        src={src}
        title="SoundCloud"
        loading="lazy"
        allow="autoplay"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
};

export const SpotifyEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => {
  const info = getSpotifyEmbed(url);
  if (!info) return null;
  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <iframe
        className="link-embed-iframe-spotify"
        src={info.embedSrc}
        title="Spotify"
        height={info.height}
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
};

export const TikTokEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => {
  const id = getTikTokVideoId(url);
  if (!id) return null;
  const src = `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}`;
  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <iframe
        className="link-embed-iframe-tiktok"
        src={src}
        title="TikTok"
        loading="lazy"
        allow="autoplay; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
};

export const InstagramEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => {
  const src = getInstagramEmbedSrc(url);
  if (!src) return null;
  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <iframe
        className="link-embed-iframe-instagram"
        src={src}
        title="Instagram"
        loading="lazy"
        allow="autoplay; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
};

export const YouTubeEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) return null;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`;
  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <iframe
        className="link-embed-iframe"
        src={embedUrl}
        title="YouTube video"
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
};

export const VimeoEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => {
  const videoId = getVimeoVideoId(url);
  if (!videoId) return null;
  const embedUrl = `https://player.vimeo.com/video/${encodeURIComponent(videoId)}`;
  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <iframe
        className="link-embed-iframe"
        src={embedUrl}
        title="Vimeo video"
        loading="lazy"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
};

const X_EMBED_ORIGIN = "https://platform.twitter.com";

/** Twitter's own embed page in a frame, so its script runs on its origin rather than ours. It posts its height back. */
export const XEmbed = ({ url, onDismiss }: { url: string; serverHost: string; onDismiss: () => void }) => {
  const { resolvedAppearance } = useTheme();
  const id = /\/status(?:es)?\/(\d+)/.exec(url)?.[1] ?? null;
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setSize(null);
    setFailed(false);
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== X_EMBED_ORIGIN || e.source !== frame.current?.contentWindow) return;
      let call: { method?: string; params?: { width?: number; height?: number }[] } | undefined;
      try {
        call = (typeof e.data === "string" ? JSON.parse(e.data) : e.data)?.["twttr.embed"];
      } catch {
        return;
      }
      if (call?.method === "twttr.private.no_results") setFailed(true);
      const box = call?.method === "twttr.private.resize" ? call.params?.[0] : undefined;
      // The card is narrower than the frame, and Twitter's page is white beside it.
      if (box?.width && box.height) setSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [id, resolvedAppearance]);

  if (!id || failed) return null;
  const src = `${X_EMBED_ORIGIN}/embed/Tweet.html?id=${id}&theme=${resolvedAppearance}&dnt=true`;

  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      {size === null && (
        <div className="link-embed-twitter-skeleton">
          <Skeleton className="rounded-(--gryt-radius-md)" width="100%" height="100%" />
        </div>
      )}
      <iframe
        ref={frame}
        className="link-embed-iframe-twitter"
        title="Post on X"
        src={src}
        style={size === null ? { position: "absolute", opacity: 0, pointerEvents: "none" } : { width: size.width, maxWidth: "100%", height: size.height }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
};

export const AudioEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => (
  <div className="link-embed-container link-embed-audio-wrap">
    <DismissButton onDismiss={onDismiss} />
    <audio src={url} controls className="link-embed-audio" preload="metadata" />
  </div>
);
