import { Menu, Tooltip } from "@gryt/ui";
import { useScreenShare } from "@gryt/voice";
import { type CSSProperties, useCallback, useState } from "react";
import toast from "react-hot-toast";

import { useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";
import { PiMonitorArrowUpFill } from "../../../../lib/icons";
import { windowPresets } from "../adapters/useExtraScreenWindows";
import { presetKey, presetLabel, SCREEN_PRESETS } from "../utils/streamQuality";
import { useCallButtonPress } from "./callButtonPress";
import { CallControlButton, type CallControlButtonProps } from "./CallControlButton";
import { ScreenSharePickerModal,type SharePick } from "./ScreenSharePickerModal";

interface ScreenShareControlProps {
  iconSize?: number;
  size?: CallControlButtonProps["size"];
  buttonStyle?: CSSProperties;
  /** Added to the idle button only; live keeps its green. */
  idleClassName?: string;
  /** Whether the room lets you start one. A share already on keeps its button either way. */
  allowed?: boolean;
  /** Which way the menu opens: up from the call bar, right from the sidebar's column. */
  side?: "top" | "right";
  /** The call bar's button, which opens the picker when the rail's share is pressed. */
  takesRailPress?: boolean;
}

/** Off, it opens the picker. Live, it opens a menu, so a stray click can't end the share. */
export function ScreenShareControl({ iconSize = 16, size, buttonStyle, idleClassName, allowed = true, side = "top", takesRailPress = false }: ScreenShareControlProps) {
  const {
    screenShareActive, nativeEncodedCodec,
    startScreenShare, stopScreenShare, addScreenWindow,
  } = useScreenShare();
  const {
    screenShareQuality, setScreenShareQuality,
    screenShareFps, setScreenShareFps,
  } = useSettings();
  const [picker, setPicker] = useState<"start" | "switch" | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const start = useCallback(
    async ([first, ...rest]: SharePick[], mode: "start" | "switch") => {
      const toastId = "screen-share-starting";
      setIsStarting(true);
      toast.loading(mode === "switch" ? "Switching…" : "Starting screen share…", { id: toastId });
      try {
        setScreenShareQuality(first.quality);
        setScreenShareFps(first.fps);
        await startScreenShare(first.withAudio, first.sourceId || undefined);
        for (const p of rest) {
          windowPresets.set(p.sourceId, p);
          await addScreenWindow(p.withAudio, p.sourceId);
        }
      } finally {
        setIsStarting(false);
        toast.dismiss(toastId);
      }
    },
    [startScreenShare, addScreenWindow, setScreenShareQuality, setScreenShareFps],
  );

  // The browser brings its own picker, so the app's one is only for the desktop app.
  const openPicker = (mode: "start" | "switch") => {
    if (isElectron()) setPicker(mode);
    else void start([{ sourceId: "", quality: screenShareQuality, fps: screenShareFps, withAudio: true }], mode);
  };

  useCallButtonPress("share", () => openPicker("start"), takesRailPress && !screenShareActive);

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
      {screenShareActive && (
        <Menu.Root>
          <Menu.Trigger
            render={
              <CallControlButton size={size} style={buttonStyle} state="live" aria-label="Sharing your screen" />
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
      )}
      {!screenShareActive && isStarting && (
        <Tooltip title="Starting screen share…">
          <CallControlButton size={size} style={buttonStyle} className={idleClassName} state="idle" aria-label="Starting screen share" disabled>
            <PiMonitorArrowUpFill size={iconSize} />
          </CallControlButton>
        </Tooltip>
      )}
      {!screenShareActive && !isStarting && (
        <CallControlButton size={size} style={buttonStyle} className={idleClassName} state="idle" aria-label="Share your screen" onClick={() => openPicker("start")}>
          <PiMonitorArrowUpFill size={iconSize} />
        </CallControlButton>
      )}

      <ScreenSharePickerModal
        open={picker !== null}
        onOpenChange={(open) => { if (!open) setPicker(null); }}
        mode={picker ?? "start"}
        quality={screenShareQuality}
        fps={screenShareFps}
        onStart={(picks) => void start(picks, picker ?? "start")}
      />
    </>
  );
}
