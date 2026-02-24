import { useEffect, useState } from "react";
import { MdClose } from "react-icons/md";

import { getServerAccessToken, getServerHttpBase } from "@/common";

import {
  getInstagramEmbedSrc,
  getSpotifyEmbed,
  getTikTokVideoId,
  getTwitchEmbed,
  getVimeoVideoId,
  getYouTubeVideoId,
  imageEmbedSizeCache,
  parseRemoteImageMetadata,
  safeJsonParseOEmbed,
} from "./embedUtils";
import { SkeletonBase } from "./skeletons/SkeletonBase";

export const DismissButton = ({ onDismiss }: { onDismiss: () => void }) => (
  <button
    className="link-embed-dismiss"
    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
    title="Remove embed"
  >
    <MdClose size={14} />
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

export const VideoEmbed = ({ url, onDismiss }: { url: string; onDismiss: () => void }) => (
  <div className="link-embed-container">
    <DismissButton onDismiss={onDismiss} />
    <video src={url} controls className="link-embed-video" preload="metadata" />
  </div>
);

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
    const u = new URL("https://player.twitch.tv/");
    if (embed.kind === "clip") {
      u.searchParams.set("clip", embed.value);
    } else if (embed.kind === "video") {
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

export const XEmbed = ({ url, serverHost, onDismiss }: { url: string; serverHost: string; onDismiss: () => void }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setHtml(null);
    setFailed(false);
  }, [url]);

  useEffect(() => {
    if (html || failed) return;
    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) { setFailed(true); return; }
    const base = getServerHttpBase(serverHost);
    let cancelled = false;
    fetch(`${base}/api/oembed?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("oembed_failed"))))
      .then((j: unknown) => {
        if (cancelled) return;
        const parsed = safeJsonParseOEmbed(j);
        if (!parsed) { setFailed(true); return; }
        setHtml(parsed.html);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [url, serverHost, html, failed]);

  if (failed) return null;
  if (!html) {
    return (
      <div className="link-embed-container">
        <DismissButton onDismiss={onDismiss} />
        <div className="link-embed-twitter-skeleton">
          <SkeletonBase width="100%" height="100%" borderRadius="var(--radius-4)" />
        </div>
      </div>
    );
  }

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>html,body{margin:0;padding:0;background:transparent;}body{display:flex;justify-content:center;}blockquote{margin:0!important;}</style></head><body>${html}<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script></body></html>`;

  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <iframe
        className="link-embed-iframe-twitter"
        title="X"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
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
