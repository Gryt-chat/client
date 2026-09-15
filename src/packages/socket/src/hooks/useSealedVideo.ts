import { useCallback, useEffect, useRef, useState } from "react";

import { readBlobUrl } from "../utils/downloadFile";

export type SealedVideoPhase = "idle" | "opening" | "failed";

export type SealedVideo = {
  src: string | null;
  phase: SealedVideoPhase;
  start: () => void;
  /** The decrypted file, for Save As: the copy made for play, or a new one that doesn't start playback. */
  file: () => Promise<Blob>;
};

/**
 * A sealed video's blob URL, made on `start` and revoked on unmount. Until then
 * `src` is null and nothing has been fetched (GRYT-1171).
 */
export function useSealedVideo(open: () => Promise<Blob>): SealedVideo {
  const [src, setSrc] = useState<string | null>(null);
  const [phase, setPhase] = useState<SealedVideoPhase>("idle");
  const busy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src);
    },
    [src],
  );

  const start = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setPhase("opening");
    open().then(
      (blob) => {
        const url = URL.createObjectURL(blob);
        // Gone while it was decrypting: nothing will ever revoke this one.
        if (!mounted.current) URL.revokeObjectURL(url);
        else setSrc(url);
      },
      () => {
        busy.current = false;
        if (mounted.current) setPhase("failed");
      },
    );
  }, [open]);

  const file = useCallback(() => (src ? readBlobUrl(src) : open()), [src, open]);

  return { src, phase, start, file };
}
