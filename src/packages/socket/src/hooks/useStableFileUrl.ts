import { useCallback, useState } from "react";

import { getUploadsFileUrl } from "@/common";

type Held = { host: string; fileId: string; thumb: boolean; url: string };

function build(host: string, fileId: string, thumb: boolean): string {
  return getUploadsFileUrl(host, fileId, thumb ? { thumb: true } : undefined);
}

/**
 * An upload's URL, built once and held while mounted, so a token refresh does not reload it.
 * `refresh` swaps in the current token, and does nothing when that token is the one already held.
 */
export function useStableFileUrl(host: string, fileId: string, thumb = false): [string, () => void] {
  const [held, setHeld] = useState<Held>(() => ({ host, fileId, thumb, url: build(host, fileId, thumb) }));

  let current = held;
  if (held.host !== host || held.fileId !== fileId || held.thumb !== thumb) {
    current = { host, fileId, thumb, url: build(host, fileId, thumb) };
    setHeld(current);
  }

  const refresh = useCallback(() => {
    setHeld((prev) => {
      const fresh = build(prev.host, prev.fileId, prev.thumb);
      return fresh === prev.url ? prev : { ...prev, url: fresh };
    });
  }, []);

  return [current.url, refresh];
}
