import { styleSwatch } from "@gryt/ui";
import { useEffect, useState } from "react";

import type { CardPreset } from "../../../socket/src/lib/memberCard/cardPresets";

/** A saved card: its colours, with the banner across the top when it has one. */
export function CardPresetTile({ preset, onPick, onForget }: { preset: CardPreset; onPick: () => void; onForget: () => void }) {
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const isVideo = !!preset.banner?.type.startsWith("video/");

  useEffect(() => {
    if (!preset.banner) return setBannerUrl(null);
    const url = URL.createObjectURL(preset.banner);
    setBannerUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preset.banner]);

  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={preset.banner ? "Use this card and its banner again" : "Use this card again"}
        onClick={onPick}
        className="relative block h-9 w-14 cursor-pointer overflow-hidden rounded-(--gryt-radius-md) border border-gryt-border hover:border-gryt-accent"
        style={{ background: styleSwatch(preset.style) }}
      >
        {bannerUrl && (isVideo
          ? <video src={bannerUrl} muted playsInline preload="metadata" className="pointer-events-none absolute inset-x-0 top-0 h-1/2 w-full object-cover" />
          : <img src={bannerUrl} alt="" className="pointer-events-none absolute inset-x-0 top-0 h-1/2 w-full object-cover" />)}
      </button>
      <button
        type="button"
        aria-label="Forget this card"
        onClick={onForget}
        className="absolute -top-1.5 -right-1.5 hidden size-4 cursor-pointer items-center justify-center rounded-full border border-gryt-border bg-gryt-surface-raised text-[10px] leading-none text-gryt-muted group-focus-within:flex group-hover:flex hover:text-gryt-text"
      >
        ×
      </button>
    </div>
  );
}
