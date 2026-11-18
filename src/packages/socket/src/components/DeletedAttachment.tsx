import type { CSSProperties } from "react";

import { PiFileFill, PiImageFill } from "../../../../lib/icons";

/** A file an owner deleted. The message keeps its place and says what was there. */
export function DeletedAttachment({ name, tile, style }: { name: string | null; tile?: boolean; style?: CSSProperties }) {
  if (tile) {
    return (
      <div role="img" aria-label={name ? `${name}, deleted` : "Image deleted"}
        style={{ borderRadius: "var(--gryt-radius-md)", background: "var(--gryt-neutral-2)", border: "1px solid var(--gryt-neutral-4)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 0, ...style }}>
        <PiImageFill size={20} style={{ color: "var(--gryt-neutral-9)" }} />
        <span className="text-xs text-gryt-muted">Image deleted</span>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2.5 self-start max-w-full"
      style={{ background: "var(--gryt-neutral-2)", border: "1px solid var(--gryt-neutral-4)", borderRadius: "var(--gryt-radius-md)", padding: "10px 14px 10px 12px", ...style }}>
      <PiFileFill size={18} style={{ color: "var(--gryt-neutral-9)", flexShrink: 0 }} />
      <span className="text-[13px] text-gryt-muted truncate">
        {name && <span style={{ textDecoration: "line-through", textDecorationColor: "var(--gryt-neutral-9)" }}>{name}</span>}
        {name ? " · Deleted" : "File deleted"}
      </span>
    </div>
  );
}
