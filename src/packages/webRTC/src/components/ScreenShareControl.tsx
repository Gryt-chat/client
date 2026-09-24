import { Menu, Tooltip } from "@gryt/ui";
import { type ScreenShareQuality, useScreenShare } from "@gryt/voice";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import { useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";
import { PiMonitorArrowUpFill, PiMonitorFill } from "../../../../lib/icons";
import { presetKey, presetLabel, SCREEN_PRESETS } from "../utils/streamQuality";
import { CallControlButton } from "./CallControlButton";
import { ScreenSharePickerModal } from "./ScreenSharePickerModal";

interface ScreenShareControlProps {
  iconSize?: number;
  /** Whether the room lets you start one. A share already on keeps its button either way. */
  allowed?: boolean;
  /** Which way the menu opens: up from the call bar, right from the sidebar's column. */
  side?: "top" | "right";
}

/** Off, it opens the picker. Live, it opens a menu, so a stray click can't end the share. */
export function ScreenShareControl({ iconSize = 16, allowed = true, side = "top" }: ScreenShareControlProps) {
  const {
    screenShareActive, screenVideoStream, nativeScreenCaptureAvailable, nativeEncodedCodec,
    startScreenShare, stopScreenShare,
  } = useScreenShare();
  const {
    screenShareQuality, setScreenShareQuality,
    screenShareFps, setScreenShareFps,
    experimentalScreenShare,
    screenShareGamingMode, setScreenShareGamingMode,
    screenShareCodec, setScreenShareCodec,
    screenShareMaxBitrate, setScreenShareMaxBitrate,
    screenShareScalabilityMode, setScreenShareScalabilityMode,
  } = useSettings();
  const [picker, setPicker] = useState<"start" | "switch" | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  /* voice 0.5.12 marks the share stopped when a re-pick fails but leaves the old capture
     running. Only that failure leaves a live track with the share off, so release it here. */
  useEffect(() => {
    if (screenShareActive || !screenVideoStream) return;
    if (!screenVideoStream.getVideoTracks().some((t) => t.readyState === "live")) return;
    stopScreenShare();
    toast("Couldn't switch, so your screen share stopped.", { id: "screen-share-switch-failed" });
  }, [screenShareActive, screenVideoStream, stopScreenShare]);

  const start = useCallback(
    async ({ sourceId, withAudio }: { sourceId?: string; withAudio: boolean }, mode: "start" | "switch") => {
      const toastId = "screen-share-starting";
      setIsStarting(true);
      toast.loading(mode === "switch" ? "Switching…" : "Starting screen share…", { id: toastId });
      try {
        await startScreenShare(withAudio, sourceId);
      } finally {
        setIsStarting(false);
        toast.dismiss(toastId);
      }
    },
    [startScreenShare],
  );

  // The browser brings its own picker, so the app's one is only for the desktop app.
  const openPicker = (mode: "start" | "switch") => {
    if (isElectron()) setPicker(mode);
    else void start({ withAudio: true }, mode);
  };

  const current = presetKey(screenShareQuality, screenShareFps);
  const matchesPreset = SCREEN_PRESETS.some((p) => presetKey(p.quality, p.fps) === current);
  const pickPreset = (key: string) => {
    const [quality, fps] = key.split("@");
    setScreenShareQuality(quality);
    setScreenShareFps(Number(fps));
  };

  if (!allowed && !screenShareActive && !isStarting) return null;

  return (
    <>
      {screenShareActive ? (
        <Menu.Root>
          <Menu.Trigger
            render={
              <CallControlButton state="live" aria-label="Sharing your screen" />
            }
          >
            <PiMonitorArrowUpFill size={iconSize} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side={side}>
              <Menu.Popup aria-label="Screen share">
                {/* The native encoder picks its own size and rate, so these would do nothing there. */}
                {!nativeEncodedCodec && (
                  <>
                    <Menu.Group>
                      <Menu.GroupLabel>Quality</Menu.GroupLabel>
                      <Menu.RadioGroup value={current} onValueChange={(v) => pickPreset(String(v))}>
                        {!matchesPreset && (
                          <Menu.RadioItem value={current}>
                            {presetLabel(screenShareQuality, screenShareFps)}
                          </Menu.RadioItem>
                        )}
                        {SCREEN_PRESETS.map((p) => (
                          <Menu.RadioItem key={presetKey(p.quality, p.fps)} value={presetKey(p.quality, p.fps)}>
                            <span>{presetLabel(p.quality, p.fps)}</span>
                            <span className="text-xs text-gryt-muted">{p.hint}</span>
                          </Menu.RadioItem>
                        ))}
                      </Menu.RadioGroup>
                    </Menu.Group>
                    <Menu.Separator />
                  </>
                )}
                <Menu.Item onClick={() => openPicker("switch")}>Share something else</Menu.Item>
                {/* "Add another window" goes here once the SFU takes more than one share each (GRYT-1335). */}
                <Menu.Separator />
                <Menu.Item className="text-gryt-danger" onClick={stopScreenShare}>
                  Stop sharing
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ) : isStarting ? (
        <Tooltip title="Starting screen share…">
          <CallControlButton state="idle" aria-label="Starting screen share" disabled>
            <PiMonitorFill size={iconSize} />
          </CallControlButton>
        </Tooltip>
      ) : (
        <CallControlButton state="idle" aria-label="Share your screen" onClick={() => openPicker("start")}>
          <PiMonitorFill size={iconSize} />
        </CallControlButton>
      )}

      <ScreenSharePickerModal
        open={picker !== null}
        onOpenChange={(open) => { if (!open) setPicker(null); }}
        mode={picker ?? "start"}
        quality={screenShareQuality as ScreenShareQuality}
        onQualityChange={setScreenShareQuality}
        fps={screenShareFps}
        onFpsChange={setScreenShareFps}
        experimentalScreenShare={experimentalScreenShare}
        gamingMode={screenShareGamingMode}
        onGamingModeChange={setScreenShareGamingMode}
        codec={screenShareCodec}
        onCodecChange={setScreenShareCodec}
        maxBitrate={screenShareMaxBitrate}
        onMaxBitrateChange={setScreenShareMaxBitrate}
        scalabilityMode={screenShareScalabilityMode}
        onScalabilityModeChange={setScreenShareScalabilityMode}
        nativeScreenCaptureAvailable={nativeScreenCaptureAvailable}
        onStart={(opts) => void start(opts, picker ?? "start")}
      />
    </>
  );
}
