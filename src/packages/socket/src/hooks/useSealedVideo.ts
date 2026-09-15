import { useCallback, useEffect, useRef, useState } from "react";

export type SealedVideoPhase = "idle" | "opening" | "failed";

/**
 * A sealed video's blob URL, made on `start` and revoked on unmount. Until then
 * `src` is null and nothing has been fetched (GRYT-1171).
 */
export function useSealedVideo(open: () => Promise<Blob>): {
  src: string | null;
  phase: SealedVideoPhase;
  start: () => void;
} {
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

  return { src, phase, start };
}
