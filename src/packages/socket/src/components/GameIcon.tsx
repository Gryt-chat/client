import { useState } from "react";

import { gameIconUrl } from "../lib/gameCard";

/** A game's mirrored icon, or a plain placeholder when there is no id or the fetch 404s. */
export function GameIcon({ appId, name, size = 32 }: { appId: string | undefined; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const url = gameIconUrl(appId);

  if (!url || failed) {
    return (
      <div
        aria-hidden="true"
        className="shrink-0 rounded-(--gryt-radius-sm)"
        style={{
          width: size,
          height: size,
          background:
            "repeating-linear-gradient(45deg, var(--gryt-neutral-4), var(--gryt-neutral-4) 3px, var(--gryt-neutral-3) 3px, var(--gryt-neutral-3) 6px)",
        }}
      />
    );
  }

  return (
    <img
      src={url}
      alt=""
      title={name}
      width={size}
      height={size}
      className="shrink-0 rounded-(--gryt-radius-sm) object-cover"
      onError={() => setFailed(true)}
    />
  );
}
