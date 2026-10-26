import { Menu } from "@gryt/ui";
import { useCamera } from "@gryt/voice";
import { useState } from "react";

import { useSettings } from "@/settings";

import { PiCameraFill, PiCameraSlashFill } from "../../../../lib/icons";
import { CAMERA_PRESETS, presetKey, presetLabel } from "../utils/streamQuality";
import { BAR_BUTTON_STYLE, CallControlButton, type CallControlButtonProps, SplitControl } from "./CallControlButton";
import { CameraPreviewModal } from "./CameraPreviewModal";

interface CameraControlProps {
  iconSize?: number;
  size?: CallControlButtonProps["size"];
  /** Whether the room lets you start one. A camera already on keeps its button either way. */
  allowed?: boolean;
  side?: "top" | "right";
  /** The call bar's split button, with an arrow for the menu. The rail stays a plain toggle. */
  split?: boolean;
}

/** Off, it opens the preview. Live, a menu: the engine reopens the camera on a new setting. */
export function CameraControl({ iconSize = 16, size, allowed = true, side = "top", split = false }: CameraControlProps) {
  const { cameraEnabled, setCameraEnabled, devices } = useCamera();
  const {
    cameraID, setCameraID, cameraQuality, setCameraQuality,
    cameraFps, setCameraFps,
    cameraMirrored, setCameraMirrored,
    cameraFlipped, setCameraFlipped,
  } = useSettings();
  const [showPreview, setShowPreview] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const buttonStyle = split ? BAR_BUTTON_STYLE : undefined;

  const current = presetKey(cameraQuality, cameraFps);
  const matchesPreset = CAMERA_PRESETS.some((p) => presetKey(p.quality, p.fps) === current);
  const pickPreset = (key: string) => {
    const [quality, fps] = key.split("@");
    setCameraQuality(quality);
    setCameraFps(Number(fps));
  };
  const cameras = devices.filter((d) => d.deviceId);

  if (!allowed && !cameraEnabled) return null;

  const control = (
    <>
      {cameraEnabled ? (
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger render={<CallControlButton size={size} style={buttonStyle} state="live" aria-label="Camera is on" />}>
            <PiCameraFill size={iconSize} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side={side}>
              <Menu.Popup aria-label="Camera">
                <Menu.Group>
                  <Menu.GroupLabel>Quality</Menu.GroupLabel>
                  <Menu.RadioGroup value={current} onValueChange={(v) => pickPreset(String(v))}>
                    {!matchesPreset && (
                      <Menu.RadioItem value={current}>{presetLabel(cameraQuality, cameraFps)}</Menu.RadioItem>
                    )}
                    {CAMERA_PRESETS.map((p) => (
                      <Menu.RadioItem key={presetKey(p.quality, p.fps)} value={presetKey(p.quality, p.fps)}>
                        <span>{presetLabel(p.quality, p.fps)}</span>
                        <span className="text-xs text-gryt-muted">{p.hint}</span>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Group>
                {/* Only with a second camera to switch to. */}
                {cameras.length > 1 && (
                  <>
                    <Menu.Separator />
                    <Menu.Group>
                      <Menu.GroupLabel>Camera</Menu.GroupLabel>
                      <Menu.RadioGroup value={cameraID} onValueChange={(v) => setCameraID(String(v))}>
                        {cameras.map((d, i) => (
                          <Menu.RadioItem key={d.deviceId} value={d.deviceId}>
                            <span className="truncate">{d.label || `Camera ${i + 1}`}</span>
                          </Menu.RadioItem>
                        ))}
                      </Menu.RadioGroup>
                    </Menu.Group>
                  </>
                )}
                <Menu.Separator />
                <Menu.Item className="text-gryt-danger" onClick={() => setCameraEnabled(false)}>
                  Turn camera off
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      ) : (
        <CallControlButton size={size} style={buttonStyle} state="idle" aria-label="Turn camera on" onClick={() => setShowPreview(true)}>
          <PiCameraSlashFill size={iconSize} />
        </CallControlButton>
      )}

      <CameraPreviewModal
        open={showPreview}
        onOpenChange={setShowPreview}
        cameraID={cameraID}
        onCameraIDChange={setCameraID}
        quality={cameraQuality}
        onQualityChange={setCameraQuality}
        fps={cameraFps}
        onFpsChange={setCameraFps}
        mirrored={cameraMirrored}
        onMirroredChange={setCameraMirrored}
        flipped={cameraFlipped}
        onFlippedChange={setCameraFlipped}
        onStart={() => setCameraEnabled(true)}
      />
    </>
  );

  if (!split) return control;
  return (
    <SplitControl
      state={cameraEnabled ? "live" : "idle"}
      arrowLabel="Camera options"
      arrowOpen={menuOpen}
      onArrow={() => (cameraEnabled ? setMenuOpen(true) : setShowPreview(true))}
    >
      {control}
    </SplitControl>
  );
}
