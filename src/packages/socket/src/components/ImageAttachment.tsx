import { Skeleton } from "@gryt/ui";
import { memo, useCallback, useState } from "react";


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
   * `data-unsized` gives a placeholder box until the image loads, and drops off
   * after. Without it the wrapper takes no space and then jumps to full size.
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
        <Skeleton
          className="rounded-(--gryt-radius-md)"
          width="100%"
          height="100%"
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
