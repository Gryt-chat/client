import { useCallback, useEffect, useRef, useState } from "react";

import type { PopoutHandle } from "../utils/popoutVideo";
import { popoutStream } from "../utils/popoutVideo";

export function usePopoutStreams(gridItems: string[]) {
  const handles = useRef(new Map<string, PopoutHandle>());
  const [poppedOutItems, setPoppedOutItems] = useState<Set<string>>(new Set());

  const popout = useCallback((itemId: string, stream: MediaStream, title: string) => {
    const existing = handles.current.get(itemId);
    if (existing?.isOpen()) {
      existing.close();
      return;
    }

    const handle = popoutStream(stream, title, {
      onClose: () => {
        handles.current.delete(itemId);
        setPoppedOutItems((prev) => {
          const next = new Set(prev);
          next.delete(itemId);
          return next;
        });
      },
    });

    if (handle) {
      handles.current.set(itemId, handle);
      setPoppedOutItems((prev) => new Set(prev).add(itemId));
    }
  }, []);

  useEffect(() => {
    const gridSet = new Set(gridItems);
    const stale = [...handles.current.entries()].filter(([id]) => !gridSet.has(id));
    for (const [, handle] of stale) {
      handle.close();
    }
  }, [gridItems]);

  useEffect(() => {
    const h = handles;
    return () => {
      for (const handle of h.current.values()) {
        handle.close();
      }
    };
  }, []);

  const updatePopoutStream = useCallback((itemId: string, stream: MediaStream) => {
    handles.current.get(itemId)?.updateStream(stream);
  }, []);

  return { poppedOutItems, popout, updatePopoutStream };
}
