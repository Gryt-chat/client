import { useScreenShare } from "@gryt/voice";
import { useCallback, useEffect, useState } from "react";

import { singletonHook } from "@/common";

import { type DesktopSource, getElectronAPI, isElectron } from "../../../../lib/electron";

export interface ScreenAudioApp {
  /** The desktopCapturer window source id, which is also the capture's id. */
  id: string;
  name: string;
  appIcon: string;
  captured: boolean;
}

export interface ScreenAudioSources {
  /** Whether audio can be taken per application at all. Windows only. */
  supported: boolean;
  /** True while the share is sending everything except Gryt. */
  wholeMachine: boolean;
  apps: ScreenAudioApp[];
  refresh: () => Promise<void>;
  setCaptured: (id: string, captured: boolean) => Promise<void>;
  captureWholeMachine: () => Promise<void>;
}

const init: ScreenAudioSources = {
  supported: false,
  wholeMachine: true,
  apps: [],
  refresh: async () => {},
  setCaptured: async () => {},
  captureWholeMachine: async () => {},
};

/** The capture that stands for "everything except Gryt", named in the main process. */
const SYSTEM_SOURCE_ID = "system";

/**
 * Which applications a running screen share is taking audio from.
 *
 * A share starts on everything except Gryt. Picking applications swaps that
 * for one capture process each, which is the only way Windows will do it — a
 * process loopback client activates against a single PID. The main process
 * owns that set and sums what comes back, so this hook is a remote control
 * rather than the thing holding the state.
 *
 * Windows only, and the UI is expected to ask `supported` before offering it:
 * the macOS capture helper ignores the process it is handed and takes the
 * machine either way.
 */
function useScreenAudioSourcesHook(): ScreenAudioSources {
  const { screenShareActive } = useScreenShare();
  const [supported, setSupported] = useState(false);
  const [windows, setWindows] = useState<DesktopSource[]>([]);
  const [capturedIds, setCapturedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!isElectron()) return;

    let cancelled = false;
    getElectronAPI()
      ?.isPerApplicationAudioSupported()
      .then((v) => {
        if (!cancelled) setSupported(v);
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The set belongs to a share, so it goes away with one. Reading it back from
  // the main process rather than assuming keeps the two from drifting when a
  // capture dies on its own.
  useEffect(() => {
    if (!screenShareActive) {
      setCapturedIds([]);
      setWindows([]);
      return;
    }

    let cancelled = false;
    getElectronAPI()
      ?.listAudioCaptureSources()
      .then((sources) => {
        if (!cancelled) setCapturedIds(sources.map((s) => s.id));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [screenShareActive]);

  const refresh = useCallback(async () => {
    const api = getElectronAPI();
    if (!api) return;

    const [sources, active] = await Promise.all([
      api.getDesktopSources(),
      api.listAudioCaptureSources(),
    ]);

    setWindows(sources.filter((s) => s.sourceType === "window"));
    setCapturedIds(active.map((s) => s.id));
  }, []);

  const apply = useCallback(async (ids: string[]) => {
    const api = getElectronAPI();
    if (!api) return;

    const active = await api.setAudioCaptureApplications(ids);
    setCapturedIds(active.map((s) => s.id));
  }, []);

  const setCaptured = useCallback(
    async (id: string, captured: boolean) => {
      const current = capturedIds.filter((v) => v !== SYSTEM_SOURCE_ID);
      const next = captured
        ? [...new Set([...current, id])]
        : current.filter((v) => v !== id);

      // Turning the last one off is not silence — it is the share going back
      // to what it started as.
      await apply(next);
    },
    [capturedIds, apply],
  );

  const captureWholeMachine = useCallback(() => apply([]), [apply]);

  const wholeMachine = capturedIds.length === 0 || capturedIds.includes(SYSTEM_SOURCE_ID);

  return {
    supported,
    wholeMachine,
    apps: windows.map((w) => ({
      id: w.id,
      name: w.name,
      appIcon: w.appIcon,
      captured: capturedIds.includes(w.id),
    })),
    refresh,
    setCaptured,
    captureWholeMachine,
  };
}

export const useScreenAudioSources = singletonHook<ScreenAudioSources>(
  init,
  useScreenAudioSourcesHook,
);
