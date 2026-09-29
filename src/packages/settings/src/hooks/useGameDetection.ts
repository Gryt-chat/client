import { useCallback, useEffect, useState } from "react";

import { type GameDetectionStatus,getElectronAPI, isElectron } from "../../../../lib/electron";

const EMPTY: GameDetectionStatus = { enabled: false, answers: [], pending: [] };

/** Known games spotted by their program, and what you said about each (GRYT-1636). */
export function useGameDetection() {
  const api = isElectron() ? getElectronAPI() : null;
  const [status, setStatus] = useState<GameDetectionStatus>(EMPTY);

  useEffect(() => {
    void api?.getGameDetection?.().then((next) => next && setStatus(next));
    return api?.onGameDetectionChanged?.((next) => setStatus(next));
  }, [api]);

  const setEnabled = useCallback(
    async (allow: boolean) => {
      const next = await api?.setGameDetection?.(allow);
      if (next) setStatus(next);
    },
    [api],
  );

  const answer = useCallback(
    async (appId: string, value: "show" | "hide" | null) => {
      const next = await api?.answerGameDetection?.(appId, value);
      if (next) setStatus(next);
    },
    [api],
  );

  return { ...status, supported: !!api?.getGameDetection, setEnabled, answer };
}
