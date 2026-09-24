import { type RefObject, useEffect } from "react";

import { watchDrawnSize } from "../lib/drawnVideoSize";

/** Reports how big this element draws `stream`, so the sender can send no more than that. */
export function useDrawnVideoSize(
  ref: RefObject<HTMLVideoElement | null>,
  stream: MediaStream | null,
  fit: "cover" | "contain",
) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !stream) return;
    return watchDrawnSize(el, stream.id, fit);
  }, [ref, stream, fit]);
}
