import { memo, useCallback, useState } from "react";

import { SkeletonBase } from "./skeletons";

interface ImageAttachmentProps {
  src: string;
  alt: string;
  width: number | null | undefined;
  height: number | null | undefined;
  onClick: () => void;
}

export const ImageAttachment = memo(({
  src,
  alt,
  width,
  height,
  onClick,
}: ImageAttachmentProps) => {
  const [loaded, setLoaded] = useState(false);
  const handleLoad = useCallback(() => setLoaded(true), []);

  const hasDimensions = width && height;

  /*
   * Without dimensions there is nothing to reserve, and the wrapper is
   * `width: fit-content` with no height — so it takes up nothing until the file
   * arrives and then jumps to full size, shoving everything below it down. The
   * skeleton is `position: absolute; inset: 0`, so it is invisible too: a
   * zero-height box has nothing to fill.
   *
   * `data-unsized` gives it a placeholder box until the image loads, and drops
   * off once it has, so the real picture is never boxed by a guess. The server
   * derives width and height on upload, so this is the uncommon path.
   */
  return (
    <div className="chat-attachment-image-wrapper"
      data-unsized={!hasDimensions && !loaded ? "" : undefined}
      style={hasDimensions ? {
        aspectRatio: `${width} / ${height}`,
        "--img-w": `${width}px`,
      } as React.CSSProperties : undefined}
    >
      {!loaded && (
        <SkeletonBase
          width="100%"
          height="100%"
          borderRadius="var(--gryt-radius-md)"
          style={{ position: "absolute", inset: 0 }}
        />
      )}
      <img
        src={src}
        alt={alt}
        className="chat-attachment-image"
        loading="lazy"
        decoding="async"
        style={{
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.2s ease",
        }}
        onLoad={handleLoad}
        onClick={onClick}
      />
    </div>
  );
});

ImageAttachment.displayName = "ImageAttachment";
