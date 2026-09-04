import {
  getAccentColor,
  getCardSubtitle,
  getLinkProvider,
  getProviderDetail,
  getProviderLogo,
  hostnameOf,
  LOGO_VIEW_BOX,
} from "@gryt/core";
import { memo, useEffect, useMemo, useState } from "react";
import { PiLinkSimpleBold } from "react-icons/pi";

import { getServerAccessToken, getServerHttpBase, useTheme } from "@/common";

import { DismissButton } from "./EmbedRenderers";
import {
  cardByline,
  describePreviewFailure,
  getLinkCardLayout,
  type LinkPreviewData,
  previewCache,
  previewRefused,
} from "./embedUtils";
import { SkeletonBase } from "./skeletons/SkeletonBase";

/**
 * The line above the title: a logo where we have one, the site's own favicon
 * where we do not, and the name it calls itself.
 */
const CardSite = memo(({
  url,
  siteName,
  favicon,
}: {
  url: string;
  siteName: string | null;
  favicon: string | null;
}) => {
  const provider = getLinkProvider(url);
  // Path data rather than a component, because the phone needs the same mark
  // and cannot draw a react-icons one. The class already sets size and colour,
  // so currentColor is all this has to say.
  const logo = provider ? getProviderLogo(provider.id) : undefined;
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => setFaviconFailed(false), [favicon]);

  return (
    <div className="link-embed-card-site">
      {logo ? (
        <svg
          className="link-embed-card-brand"
          viewBox={LOGO_VIEW_BOX}
          fill="currentColor"
          aria-hidden
        >
          <path d={logo} />
        </svg>
      ) : favicon && !faviconFailed ? (
        <img
          src={favicon}
          alt=""
          className="link-embed-card-favicon"
          loading="lazy"
          decoding="async"
          onError={() => setFaviconFailed(true)}
        />
      ) : (
        <PiLinkSimpleBold className="link-embed-card-brand" aria-hidden />
      )}
      <span className="link-embed-card-hostname">
        {provider?.label || siteName || hostnameOf(url)}
      </span>
    </div>
  );
});

CardSite.displayName = "CardSite";

export const LinkPreviewSkeleton = memo(({
  url,
  onDismiss,
}: {
  url: string;
  onDismiss: () => void;
}) => (
  <div className="link-embed-container">
    <DismissButton onDismiss={onDismiss} />
    <div className="link-embed-card link-embed-card-text" aria-busy="true">
      <div className="link-embed-card-accent" />
      <div className="link-embed-card-inner">
        <div className="link-embed-card-body">
          <CardSite url={url} siteName={null} favicon={null} />
          <SkeletonBase width="70%" height={15} borderRadius="var(--gryt-radius-sm)" />
          <SkeletonBase width="90%" height={12} borderRadius="var(--gryt-radius-sm)" />
          <SkeletonBase width="60%" height={12} borderRadius="var(--gryt-radius-sm)" />
        </div>
      </div>
    </div>
  </div>
));

LinkPreviewSkeleton.displayName = "LinkPreviewSkeleton";

/**
 * A link drawn as a card.
 *
 * The shape follows what the page actually gave us rather than one fixed
 * template — see `getLinkCardLayout`. The version before this always reserved a
 * picture slot and filled it with a grey rectangle, so a page with no
 * `og:image` came out as a hostname beside an empty box.
 */
export const LinkPreviewCard = memo(({
  url,
  serverHost,
  onDismiss,
}: {
  url: string;
  serverHost: string;
  onDismiss: () => void;
}) => {
  const { resolvedAppearance } = useTheme();
  const [data, setData] = useState<LinkPreviewData | null>(() => previewCache.get(url) ?? null);
  const [failed, setFailed] = useState(() => previewRefused.has(url));
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [url, data?.image]);

  useEffect(() => {
    if (data) return;
    // Asked before and refused. Nothing about the answer can have changed.
    if (previewRefused.has(url)) { setFailed(true); return; }

    let cancelled = false;
    const accessToken = getServerAccessToken(serverHost);
    if (!accessToken) {
      setFailed(true);
      return;
    }

    const base = getServerHttpBase(serverHost);
    fetch(`${base}/api/link-preview?url=${encodeURIComponent(url)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => {
        if (!res.ok) {
          /* 4xx is the server's verdict on this URL and will not change: it is
             private, malformed, or not something it will fetch. 5xx and a
             dropped connection are worth another go, so they are not remembered.

             A page that 404s is not one of these. That comes back as a 200
             carrying `status: 404`, because "this page is gone" is a preview
             worth drawing rather than a refusal to make one. */
          if (res.status >= 400 && res.status < 500) previewRefused.add(url);
          throw new Error(`link preview refused: ${res.status}`);
        }
        return res.json();
      })
      .then((d: LinkPreviewData) => {
        if (cancelled) return;
        previewCache.set(url, d);
        setData(d);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [url, serverHost, data]);

  const accent = useMemo(
    () => getAccentColor(url, data?.themeColor ?? null, resolvedAppearance),
    [url, data?.themeColor, resolvedAppearance],
  );

  if (failed) return null;
  if (!data) return <LinkPreviewSkeleton url={url} onDismiss={onDismiss} />;

  const provider = getLinkProvider(url);
  const providerDetail = getProviderDetail(url);
  const failure = describePreviewFailure(data.status);
  const layout = getLinkCardLayout(data);

  /* Nothing came back and nothing can be said about why. A page that is merely
     quiet does not earn a card, so it stays as the link it already was in the
     message text — unless we recognise the site, which is worth showing. */
  if (layout === "bare" && !failure && !provider) return null;

  const title = data.title || providerDetail;

  const subtitle = getCardSubtitle(data.title, providerDetail);

  const byline = cardByline(data.author, data.publishedAt);

  const showImage = Boolean(data.image) && !imageFailed && layout !== "text" && layout !== "bare";

  const image = showImage ? (
    <img
      src={data.image!}
      alt={data.imageAlt || data.title || ""}
      className="link-embed-card-image"
      width={data.imageWidth ?? undefined}
      height={data.imageHeight ?? undefined}
      loading="lazy"
      decoding="async"
      onError={() => setImageFailed(true)}
    />
  ) : null;

  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`link-embed-card link-embed-card-${layout}`}
        style={accent ? ({ "--link-embed-accent": accent } as React.CSSProperties) : undefined}
      >
        <div className="link-embed-card-accent" />
        <div className="link-embed-card-inner">
          <div className="link-embed-card-main">
            <div className="link-embed-card-body">
              <CardSite url={url} siteName={data.siteName} favicon={data.favicon} />

              {title && <div className="link-embed-card-title">{title}</div>}

              {subtitle && <div className="link-embed-card-detail">{subtitle}</div>}

              {data.description && (
                <div className="link-embed-card-description">
                  {data.description.length > 240
                    ? `${data.description.slice(0, 240)}…`
                    : data.description}
                </div>
              )}

              {/* Who made it and when, where the page said (GRYT-913).

                  The server has carried `author` and `publishedAt` for as long
                  as this card has existed and nothing drew either, so an
                  article with a byline and a MakerWorld model with a creator
                  both arrived with the two most human facts about them thrown
                  away.

                  Under the description rather than above the title. It is
                  attribution, not the headline. */}
              {byline && <div className="link-embed-card-byline">{byline}</div>}

              {failure && <div className="link-embed-card-failure">{failure}</div>}

              {!title && !data.description && !failure && (
                <div className="link-embed-card-detail">{hostnameOf(url)}</div>
              )}
            </div>

            {layout === "thumbnail" && image && (
              <div className="link-embed-card-thumb">{image}</div>
            )}
          </div>

          {layout === "large" && image && (
            <div
              className="link-embed-card-image-wrap"
              style={
                data.imageWidth && data.imageHeight
                  ? { aspectRatio: `${data.imageWidth} / ${data.imageHeight}` }
                  : undefined
              }
            >
              {image}
            </div>
          )}
        </div>
      </a>
    </div>
  );
});

LinkPreviewCard.displayName = "LinkPreviewCard";
