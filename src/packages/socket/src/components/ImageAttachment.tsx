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

  return (
    <div
      className="chat-attachment-image-wrapper"
      style={hasDimensions ? {
        aspectRatio: `${width} / ${height}`,
        "--img-w": `${width}px`,
      } as React.CSSProperties : undefined}
    >
      {!loaded && (
        <SkeletonBase
          width="100%"
          height="100%"
          borderRadius="var(--radius-4)"
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
