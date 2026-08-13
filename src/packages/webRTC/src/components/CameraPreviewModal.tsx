import { Button, Checkbox, Chip, Dialog, IconButton, Select } from "@gryt/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiArrowsClockwiseFill, PiVideoCameraFill, PiX } from "react-icons/pi";

import { CAMERA_FPS_OPTIONS, type CameraQuality, QUALITY_CONSTRAINTS } from "@/audio";
import { useSettings } from "@/settings";

interface CameraPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cameraID: string;
  onCameraIDChange: (id: string) => void;
  quality: string;
  onQualityChange: (q: string) => void;
  fps: number;
  onFpsChange: (fps: number) => void;
  mirrored: boolean;
  onMirroredChange: (m: boolean) => void;
  flipped: boolean;
  onFlippedChange: (f: boolean) => void;
  onStart: () => void;
}

const QUALITY_OPTIONS: { value: CameraQuality; label: string }[] = [
  { value: "native", label: "Native" },
  { value: "4k", label: "4K" },
  { value: "1440p", label: "1440p" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p" },
  { value: "240p", label: "240p" },
  { value: "144p", label: "144p" },
  { value: "96p", label: "96p" },
  { value: "64p", label: "64p" },
  { value: "48p", label: "48p" },
  { value: "32p", label: "32p" },
  { value: "24p", label: "24p" },
  { value: "16p", label: "16p" },
  { value: "8p", label: "8p" },
  { value: "4p", label: "4p" },
];


export function CameraPreviewModal({
  open,
  onOpenChange,
  cameraID,
  onCameraIDChange,
  quality,
  onQualityChange,
  fps,
  onFpsChange,
  mirrored,
  onMirroredChange,
  flipped,
  onFlippedChange,
  onStart,
}: CameraPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [localCameraID, setLocalCameraID] = useState(cameraID);
  const [localQuality, setLocalQuality] = useState(quality);
  const [localFps, setLocalFps] = useState(fps);
  const [localMirrored, setLocalMirrored] = useState(mirrored);
  const { faceFramingEnabled, setFaceFramingEnabled } = useSettings();
  const [localFlipped, setLocalFlipped] = useState(flipped);
  const [retryCount, setRetryCount] = useState(0);
  const [maxCameraHeight, setMaxCameraHeight] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setLocalCameraID(cameraID);
      setLocalQuality(quality);
      setLocalFps(fps);
      setLocalMirrored(mirrored);
      setLocalFlipped(flipped);
    }
  }, [open, cameraID, quality, fps, mirrored, flipped]);

  const startPreview = useCallback(async (deviceId: string, q: string, fpsVal: number) => {
    const qc = QUALITY_CONSTRAINTS[q as CameraQuality] ?? QUALITY_CONSTRAINTS.native;
    const videoConstraints: MediaTrackConstraints = {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      frameRate: { ideal: fpsVal || 30 },
    };
    if (qc.width) {
      videoConstraints.width = { ideal: qc.width };
      videoConstraints.height = { ideal: qc.height };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      return stream;
    } catch {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { ideal: deviceId } } : true,
        audio: false,
      });
      return stream;
    }
  }, []);

  function friendlyPreviewError(err: unknown): string {
    const name = err instanceof DOMException ? err.name : "";
    switch (name) {
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

  const loadDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    const video = all.filter((d) => d.kind === "videoinput");
    setDevices(video);
    if (video.length > 0 && !localCameraID) {
      setLocalCameraID(video[0].deviceId);
    }
  }, [localCameraID]);

  useEffect(() => {
    if (!open) {
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
        setPreviewStream(null);
      }
      return;
    }

    let cancelled = false;
    setPreviewError(null);

    (async () => {
      await loadDevices();

      try {
        const stream = await startPreview(localCameraID, localQuality, localFps);
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setPreviewStream((prev) => {
          if (prev) prev.getTracks().forEach((t) => t.stop());
          return stream;
        });
        setPreviewError(null);

        const all = await navigator.mediaDevices.enumerateDevices();
        const video = all.filter((d) => d.kind === "videoinput");
        setDevices(video);

        const actual = stream.getVideoTracks()[0]?.getSettings().deviceId;
        if (actual && actual !== localCameraID) {
          setLocalCameraID(actual);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[Camera] Preview failed:", err);
          setPreviewError(friendlyPreviewError(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, localCameraID, localQuality, localFps, retryCount]);

  const [actualRes, setActualRes] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

  useEffect(() => {
    if (!previewStream) {
      setActualRes(null);
      return;
    }
    const track = previewStream.getVideoTracks()[0];
    if (!track) return;
    const readRes = () => {
      const { width, height } = track.getSettings();
      if (width && height) setActualRes({ w: width, h: height });
    };
    readRes();
    const id = window.setInterval(readRes, 1000);
    return () => window.clearInterval(id);
  }, [previewStream]);

  useEffect(() => {
    if (!previewStream) {
      setMaxCameraHeight(null);
      return;
    }
    const track = previewStream.getVideoTracks()[0];
    if (!track) return;
    try {
      const caps = track.getCapabilities();
      setMaxCameraHeight(caps.height?.max ?? null);
    } catch {
      setMaxCameraHeight(null);
    }
  }, [previewStream]);

  const filteredOptions = useMemo(() => {
    if (!maxCameraHeight) return QUALITY_OPTIONS;
    return QUALITY_OPTIONS.filter((opt) => {
      if (opt.value === "native") return true;
      const c = QUALITY_CONSTRAINTS[opt.value];
      return !c?.height || c.height <= maxCameraHeight;
    });
  }, [maxCameraHeight]);

  useEffect(() => {
    if (!maxCameraHeight) return;
    const c = QUALITY_CONSTRAINTS[localQuality as CameraQuality];
    if (c?.height && c.height > maxCameraHeight) {
      setLocalQuality("native");
    }
  }, [maxCameraHeight, localQuality]);

  const handleClose = () => {
    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
      setPreviewStream(null);
    }
    onOpenChange(false);
  };

  const handleStart = () => {
    if (previewStream) {
      previewStream.getTracks().forEach((t) => t.stop());
      setPreviewStream(null);
    }
    onCameraIDChange(localCameraID);
    onQualityChange(localQuality);
    onFpsChange(localFps);
    onMirroredChange(localMirrored);
    onFlippedChange(localFlipped);
    onStart();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup style={{ maxWidth: 520 }}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PiVideoCameraFill size={16} />
              <Dialog.Title>Camera Preview</Dialog.Title>
            </div>
            <Dialog.Close>
              <IconButton tone="ghost" size="xsmall" onClick={handleClose}>
                <PiX size={16} />
              </IconButton>
            </Dialog.Close>
          </div>

          <div
            style={{
              position: "relative",
              aspectRatio: "16 / 9",
              borderRadius: "var(--radius-3)",
              overflow: "hidden",
              background: "#000",
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: (localFlipped !== localMirrored) ? "scaleX(-1)" : undefined,
              }}
            />
            {previewStream && actualRes && (
              <Chip tone="neutral"
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "rgba(0,0,0,0.65)",
                  backdropFilter: "blur(4px)",
                  color: "#fff",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {actualRes.w}×{actualRes.h}
              </Chip>
            )}
            {!previewStream && (
              <div className="flex items-center justify-center flex-col gap-2" style={{ position: "absolute", inset: 0 }}>
                <span className="text-sm" color={previewError ? "red" : "gray"}>
                  {previewError ?? "Starting camera..."}
                </span>
                {previewError && (
                  <Button tone="neutral" size="xsmall" onClick={() => setRetryCount((c) => c + 1)}>
                    <PiArrowsClockwiseFill size={14} />
                    Retry
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ minWidth: 60 }}>Camera</span>
              <Select
                className="flex-1"
                value={localCameraID}
                onValueChange={(v) => setLocalCameraID(String(v))}
                options={
                  devices.length === 0
                    ? [{ label: "No cameras found", value: "__none__", disabled: true }]
                    : devices.map((d, i) => ({
                        label: d.label || `Camera ${i + 1}`,
                        value: d.deviceId || `device-${i}`,
                      }))
                }
              />
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ minWidth: 60 }}>Quality</span>
              <Select
                className="flex-1"
                value={localQuality}
                onValueChange={(v) => setLocalQuality(String(v))}
                options={filteredOptions.map((o) => ({ label: o.label, value: o.value }))}
              />
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm" style={{ minWidth: 60 }}>FPS</span>
              <Select
                className="flex-1"
                value={String(localFps)}
                onValueChange={(v) => setLocalFps(Number(v))}
                options={CAMERA_FPS_OPTIONS.map((f) => ({
                  label: `${f} FPS`,
                  value: String(f),
                }))}
              />
            </div>

            <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <Checkbox checked={localFlipped} onCheckedChange={(v) => setLocalFlipped(v === true)} />
              Flip camera (affects what everyone sees)
            </label>

            <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <Checkbox checked={localMirrored} onCheckedChange={(v) => setLocalMirrored(v === true)} />
              Mirror preview
            </label>

            {/* Here as well as in settings, because this is the moment you are
                looking at your own framing and can see whether it needs it. */}
            <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <Checkbox
                checked={faceFramingEnabled}
                onCheckedChange={(v) => setFaceFramingEnabled(v === true)}
              />
              Center my face automatically
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button tone="neutral" size="small" onClick={handleClose}>
              Cancel
            </Button>
            <Button size="small" onClick={handleStart} disabled={!previewStream}>
              Start Camera
            </Button>
          </div>
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
