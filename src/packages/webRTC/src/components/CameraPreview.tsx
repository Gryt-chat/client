import { Button, Popover } from "@gryt/ui";
import { type CameraQuality, QUALITY_CONSTRAINTS } from "@gryt/voice";
import { useEffect, useRef, useState } from "react";

import { useSettings } from "@/settings";

import { PiArrowsClockwiseFill } from "../../../../lib/icons";
import { CameraSelect, FieldRow, QualityFields, SwitchRow } from "./cameraFields";

async function openPreview(deviceId: string, quality: string, fps: number): Promise<MediaStream> {
  const qc = QUALITY_CONSTRAINTS[quality as CameraQuality] ?? QUALITY_CONSTRAINTS.native;
  const video: MediaTrackConstraints = {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    frameRate: { ideal: fps || 30 },
    ...(qc.width ? { width: { ideal: qc.width }, height: { ideal: qc.height } } : {}),
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch {
    return navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { ideal: deviceId } } : true, audio: false });
  }
}

function friendlyPreviewError(errorName: string): string {
  switch (errorName) {
    case "NotReadableError":
    case "AbortError":
      return "Failed to start camera — is it in use by another application?";
    case "NotAllowedError":
      return "Camera access was denied. Check your permissions.";
    case "NotFoundError":
      return "No camera detected. Make sure one is connected.";
    case "OverconstrainedError":
      return "Camera doesn't support the selected quality. Try a lower setting.";
    default:
      return "Failed to start camera. Please try again.";
  }
}

/** The popover above the camera button: you see yourself before anyone else does. Mounted only while open. */
export function CameraPreview({ onStart }: { onStart: () => void }) {
  const {
    cameraID, setCameraID, cameraQuality, setCameraQuality, cameraFps, setCameraFps,
    cameraMirrored, setCameraMirrored, cameraFlipped,
    faceFramingEnabled, setFaceFramingEnabled, cameraPreviewFirst, setCameraPreviewFirst,
  } = useSettings();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(cameraID);
  const [quality, setQuality] = useState(cameraQuality);
  const [fps, setFps] = useState(cameraFps);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let opened: MediaStream | null = null;
    setError(null);
    (async () => {
      try {
        opened = await openPreview(deviceId, quality, fps);
        if (cancelled) return opened.getTracks().forEach((t) => t.stop());
        setStream(opened);
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === "videoinput"));
        const actual = opened.getVideoTracks()[0]?.getSettings().deviceId;
        if (!cancelled && actual && actual !== deviceId) setDeviceId(actual);
      } catch (err) {
        if (!cancelled) setError(friendlyPreviewError(err instanceof DOMException ? err.name : ""));
      }
    })();
    return () => {
      cancelled = true;
      opened?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId, quality, fps, retry]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const start = () => {
    setCameraID(deviceId);
    setCameraQuality(quality);
    setCameraFps(fps);
    onStart();
  };

  return (
    <>
      <div className="px-1 pt-1 pb-2.5 text-[15px] font-extrabold">Turn your camera on</div>
      <div className="relative overflow-hidden rounded-xl bg-black" style={{ height: 198 }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: cameraFlipped !== cameraMirrored ? "scaleX(-1)" : undefined }}
        />
        {!stream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-gryt-muted">
            {error ?? "Starting camera…"}
            {error && (
              <Button tone="neutral" size="xsmall" onClick={() => setRetry((n) => n + 1)}>
                <PiArrowsClockwiseFill size={14} />
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-1 py-3">
        <FieldRow label="Camera">
          <CameraSelect value={deviceId} onChange={setDeviceId} devices={devices} />
        </FieldRow>
        <QualityFields
          quality={quality}
          fps={fps}
          onChange={(q, f) => { setQuality(q); setFps(f); }}
          track={stream?.getVideoTracks()[0] ?? null}
          deviceId={deviceId}
        />
        <SwitchRow label="Keep my face centered" checked={faceFramingEnabled} onCheckedChange={setFaceFramingEnabled} />
        <SwitchRow label="Mirror my own view" checked={cameraMirrored} onCheckedChange={setCameraMirrored} />
        <SwitchRow label="Show this preview first" checked={cameraPreviewFirst} onCheckedChange={setCameraPreviewFirst} />
      </div>
      <div className="flex justify-end gap-2">
        <Popover.Close render={<Button tone="ghost" size="small" />}>Cancel</Popover.Close>
        <Popover.Close render={<Button size="small" disabled={!stream} />} onClick={start}>Turn camera on</Popover.Close>
      </div>
    </>
  );
}
