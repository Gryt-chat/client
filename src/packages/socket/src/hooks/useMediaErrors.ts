import { type RefObject, useEffect } from "react";

/**
 * Reports a failed `<video>` or `<img>` inside `ref`. Load errors don't bubble, so this listens in
 * the capture phase. VideoPlayer from @gryt/ui has no onError of its own yet (GRYT-1176).
 */
export function useMediaErrors(
  ref: RefObject<HTMLElement | null>,
  onVideoError?: () => void,
  onImageError?: () => void,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const listener = (event: Event) => {
      const tag = (event.target as Element | null)?.tagName;
      if (tag === "VIDEO") onVideoError?.();
      else if (tag === "IMG") onImageError?.();
    };
    root.addEventListener("error", listener, true);
    return () => root.removeEventListener("error", listener, true);
  }, [ref, onVideoError, onImageError]);
}
