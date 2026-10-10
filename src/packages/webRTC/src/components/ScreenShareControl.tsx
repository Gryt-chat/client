import { Menu, Tooltip } from "@gryt/ui";
import { type ScreenShareQuality, useScreenShare } from "@gryt/voice";
import { useCallback, useState } from "react";
import toast from "react-hot-toast";

import { useTranslation } from "@/i18n";
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
  const { t: tr } = useTranslation();
  const {
    screenShareActive, nativeScreenCaptureAvailable, nativeEncodedCodec,
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

  const start = useCallback(
    async ({ sourceId, withAudio }: { sourceId?: string; withAudio: boolean }, mode: "start" | "switch") => {
      const toastId = "screen-share-starting";
      setIsStarting(true);
      toast.loading(mode === "switch" ? tr("ui.switching") : tr("ui.startingScreenShare"), { id: toastId });
      try {
        await startScreenShare(withAudio, sourceId);
      } finally {
        setIsStarting(false);
        toast.dismiss(toastId);
      }
    },
    [startScreenShare, tr],
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
              <CallControlButton state="live" aria-label={tr("ui.sharingYourScreen")} />
            }
          >
            <PiMonitorArrowUpFill size={iconSize} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side={side}>
              <Menu.Popup aria-label={tr("ui.screenShare")}>
                {/* The native encoder picks its own size and rate, so these would do nothing there. */}
                {!nativeEncodedCodec && (
                  <>
                    <Menu.Group>
                      <Menu.GroupLabel>{tr("ui.quality")}</Menu.GroupLabel>
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
                <Menu.Item onClick={() => openPicker("switch")}>{tr("ui.shareSomethingElse")}</Menu.Item>
                {/* "Add another window" goes here once the SFU takes more than one share each (GRYT-1335). */}
                <Menu.Separator />
                <Menu.Item className="text-gryt-danger" onClick={stopScreenShare}>
                  {tr("ui.stopSharing")}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ) : isStarting ? (
        <Tooltip title={tr("ui.startingScreenShare")}>
          <CallControlButton state="idle" aria-label={tr("ui.startingScreenShareVariant")} disabled>
            <PiMonitorFill size={iconSize} />
          </CallControlButton>
        </Tooltip>
      ) : (
        <CallControlButton state="idle" aria-label={tr("ui.shareYourScreen")} onClick={() => openPicker("start")}>
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
