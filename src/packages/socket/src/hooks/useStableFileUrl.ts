import { useCallback, useEffect, useState } from "react";

import { getUploadsFileUrl, subscribeServerFileAccess } from "@/common";

type Held = { host: string; fileId: string; thumb: boolean; url: string };

function build(host: string, fileId: string, thumb: boolean): string {
  return getUploadsFileUrl(host, fileId, thumb ? { thumb: true } : undefined);
}

// Signed (`s=`) or an older server's token (`t=`). Without either the load was always going to fail.
const carriesAccess = (url: string): boolean => /[?&][st]=/.test(url);

/**
 * An upload's URL, built once and held while mounted, so a key refresh does not reload it.
 * `refresh` signs it again, and does nothing when that gives the URL already held.
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

  // Built before the socket proved itself and handed over a key, so signed now it has one.
  useEffect(
    () =>
      subscribeServerFileAccess((changed) => {
        setHeld((prev) => {
          if (changed !== prev.host || carriesAccess(prev.url)) return prev;
          const fresh = build(prev.host, prev.fileId, prev.thumb);
          return fresh === prev.url ? prev : { ...prev, url: fresh };
        });
      }),
    [],
  );

  return [current.url, refresh];
}
