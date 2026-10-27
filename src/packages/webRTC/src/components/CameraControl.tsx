import { Popover } from "@gryt/ui";
import { useCamera } from "@gryt/voice";
import { type RefObject, useEffect, useRef, useState } from "react";

import { useSettings } from "@/settings";
import { useVideoFraming } from "@/socket/src/hooks/useVideoFraming";

import { PiCameraFill, PiCameraSlashFill } from "../../../../lib/icons";
import { useCallButtonPress } from "./callButtonPress";
import { BAR_BUTTON_STYLE, CallControlButton, type CallControlButtonProps, SPLIT_BUTTON_CLASS, SplitArrow, SplitControl } from "./CallControlButton";
import { CameraSelect, FieldRow, QualityFields, SwitchRow } from "./cameraFields";
import { CameraPreview } from "./CameraPreview";
import { CALL_MENU_STYLE } from "./MicMenu";

interface CameraControlProps {
  iconSize?: number;
  size?: CallControlButtonProps["size"];
  /** Whether the room lets you start one. A camera already on keeps its button either way. */
  allowed?: boolean;
  side?: "top" | "right";
  /** The call bar's split button, with an arrow for the menu. The rail stays a plain toggle. */
  split?: boolean;
}

/** Centred over the split button, but no further left than the voice view's edge plus `inset`, where the narrow board puts it. */
function atPanelEdge(split: RefObject<HTMLDivElement | null>, inset: number, width: number) {
  return () => {
    const el = split.current;
    const panel = el?.closest('[data-gryt="voice-view"]')?.firstElementChild;
    if (!el || !panel) return el;
    return {
      getBoundingClientRect: () => {
        const s = el.getBoundingClientRect();
        const x = Math.max(panel.getBoundingClientRect().left + inset, s.left + s.width / 2 - width / 2);
        return DOMRect.fromRect({ x, y: s.top, width: s.width, height: s.height });
      },
    };
  };
}

// @gryt/ui's popover stops at 20rem; the board's preview is 380 and the menu 330.
const PREVIEW_STYLE = { ...CALL_MENU_STYLE, width: 380, maxWidth: "calc(100vw - 2rem)", borderRadius: 18, padding: 12 } as const;
const MENU_STYLE = { ...CALL_MENU_STYLE, width: 330, maxWidth: "calc(100vw - 2rem)" } as const;

/** Off, it opens the preview, or turns straight on. On, pressing it turns it off and the arrow opens the menu. */
export function CameraControl({ iconSize = 16, size, allowed = true, side = "top", split = false }: CameraControlProps) {
  const { cameraEnabled, setCameraEnabled } = useCamera();
  const { cameraPreviewFirst } = useSettings();
  const [open, setOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [cameraEnabled]);
  // The rail's camera, pressed while off, lands here as if this button was pressed.
  useCallButtonPress("camera", () => buttonRef.current?.click(), split && !cameraEnabled);

  if (!allowed && !cameraEnabled) return null;

  const state = cameraEnabled ? "live" : "idle";
  const buttonProps = {
    size,
    style: split ? BAR_BUTTON_STYLE : undefined,
    state,
    idleClassName: split ? SPLIT_BUTTON_CLASS : undefined,
    "aria-label": cameraEnabled ? "Turn camera off" : "Turn camera on",
  } as const;
  const icon = cameraEnabled ? <PiCameraFill size={iconSize} /> : <PiCameraSlashFill size={iconSize} />;
  const button = cameraEnabled || !cameraPreviewFirst
    ? <CallControlButton ref={buttonRef} {...buttonProps} onClick={() => setCameraEnabled(!cameraEnabled)}>{icon}</CallControlButton>
    : <Popover.Trigger render={<CallControlButton ref={buttonRef} {...buttonProps} />}>{icon}</Popover.Trigger>;

  return (
    <Popover.Root key={state} onOpenChange={setOpen}>
      {split ? (
        <SplitControl
          state={state}
          rootRef={splitRef}
          arrowOpen={open}
          arrow={<Popover.Trigger render={<SplitArrow state={state} open={open} aria-label="Camera options" />} />}
        >
          {button}
        </SplitControl>
      ) : button}
      <Popover.Portal>
        <Popover.Positioner
          side={split ? "top" : side}
          align="start"
          sideOffset={12}
          anchor={split ? atPanelEdge(splitRef, cameraEnabled ? 12 : 0, cameraEnabled ? MENU_STYLE.width : PREVIEW_STYLE.width) : undefined}
        >
          <Popover.Popup
            aria-label={cameraEnabled ? "Camera" : "Turn your camera on"}
            initialFocus={(type) => type === "keyboard"}
            style={cameraEnabled ? MENU_STYLE : PREVIEW_STYLE}
          >
            {cameraEnabled ? <CameraMenu /> : <CameraPreview onStart={() => setCameraEnabled(true)} />}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The arrow's menu while the camera is on. Every change applies straight away. */
function CameraMenu() {
  const { setCameraEnabled, devices, cameraStream } = useCamera();
  const {
    cameraID, setCameraID, cameraQuality, setCameraQuality, cameraFps, setCameraFps,
    cameraMirrored, setCameraMirrored, faceFramingEnabled, setFaceFramingEnabled,
  } = useSettings();
  const { recentre, detecting } = useVideoFraming();
  const item = "flex w-full cursor-pointer items-center rounded-[10px] border-0 bg-transparent px-2.5 py-2 text-left text-sm hover:bg-gryt-neutral-4";

  return (
    <>
      <div className="flex flex-col gap-1 px-2 py-1.5">
        <FieldRow label="Camera">
          <CameraSelect value={cameraID} onChange={setCameraID} devices={devices} />
        </FieldRow>
        <QualityFields
          quality={cameraQuality}
          fps={cameraFps}
          onChange={(q, f) => { setCameraQuality(q); setCameraFps(f); }}
          track={cameraStream?.getVideoTracks()[0] ?? null}
          deviceId={cameraID}
        />
        <SwitchRow label="Keep my face centered" checked={faceFramingEnabled} onCheckedChange={setFaceFramingEnabled} />
        <SwitchRow label="Mirror my own view" checked={cameraMirrored} onCheckedChange={setCameraMirrored} />
      </div>
      <div className="mx-1 my-1.5 h-px bg-gryt-neutral-6" />
      {/* With following on the crop is already on your face, so a one-off look would move nothing. */}
      {!faceFramingEnabled && (
        <button type="button" className={`${item} text-gryt-accent-10`} disabled={detecting} onClick={() => void recentre()}>
          Center it now
        </button>
      )}
      <Popover.Close render={<button type="button" className={`${item} text-gryt-danger`} />} onClick={() => setCameraEnabled(false)}>
        Turn camera off
      </Popover.Close>
    </>
  );
}
