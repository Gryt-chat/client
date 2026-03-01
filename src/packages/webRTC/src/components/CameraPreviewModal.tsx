import { Badge, Button, Checkbox, Dialog, Flex, IconButton, Select, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdClose, MdRefresh, MdVideocam } from "react-icons/md";

import type { CameraQuality } from "@/audio";

interface CameraPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cameraID: string;
  onCameraIDChange: (id: string) => void;
  quality: string;
  onQualityChange: (q: string) => void;
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

const QUALITY_CONSTRAINTS: Record<string, { width?: number; height?: number; frameRate: number }> = {
  native: { frameRate: 30 },
  "4k": { width: 3840, height: 2160, frameRate: 30 },
  "1440p": { width: 2560, height: 1440, frameRate: 30 },
  "1080p": { width: 1920, height: 1080, frameRate: 30 },
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "480p": { width: 854, height: 480, frameRate: 30 },
  "360p": { width: 640, height: 360, frameRate: 30 },
  "240p": { width: 426, height: 240, frameRate: 24 },
  "144p": { width: 256, height: 144, frameRate: 15 },
  "96p": { width: 170, height: 96, frameRate: 10 },
  "64p": { width: 114, height: 64, frameRate: 10 },
  "48p": { width: 85, height: 48, frameRate: 10 },
  "32p": { width: 57, height: 32, frameRate: 5 },
  "24p": { width: 43, height: 24, frameRate: 5 },
  "16p": { width: 28, height: 16, frameRate: 5 },
  "8p": { width: 14, height: 8, frameRate: 2 },
  "4p": { width: 7, height: 4, frameRate: 1 },
};

export function CameraPreviewModal({
  open,
  onOpenChange,
  cameraID,
  onCameraIDChange,
  quality,
  onQualityChange,
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
  const [localMirrored, setLocalMirrored] = useState(mirrored);
  const [localFlipped, setLocalFlipped] = useState(flipped);
  const [retryCount, setRetryCount] = useState(0);
  const [maxCameraHeight, setMaxCameraHeight] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setLocalCameraID(cameraID);
      setLocalQuality(quality);
      setLocalMirrored(mirrored);
      setLocalFlipped(flipped);
    }
  }, [open, cameraID, quality, mirrored, flipped]);

  const startPreview = useCallback(async (deviceId: string, q: string) => {
    const qc = QUALITY_CONSTRAINTS[q] ?? QUALITY_CONSTRAINTS.native;
    const videoConstraints: MediaTrackConstraints = {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      frameRate: { ideal: qc.frameRate },
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
        const stream = await startPreview(localCameraID, localQuality);
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
  }, [open, localCameraID, localQuality, retryCount]);

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
    const c = QUALITY_CONSTRAINTS[localQuality];
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
    onMirroredChange(localMirrored);
    onFlippedChange(localFlipped);
    onStart();
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <Dialog.Content style={{ maxWidth: 520 }} aria-describedby={undefined}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Flex align="center" gap="2">
              <MdVideocam size={16} />
              <Dialog.Title>Camera Preview</Dialog.Title>
            </Flex>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" onClick={handleClose}>
                <MdClose size={16} />
              </IconButton>
            </Dialog.Close>
          </Flex>

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
              <Badge
                variant="solid"
                size="1"
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
              </Badge>
            )}
            {!previewStream && (
              <Flex
                align="center"
                justify="center"
                direction="column"
                gap="2"
                style={{ position: "absolute", inset: 0 }}
              >
                <Text size="2" color={previewError ? "red" : "gray"}>
                  {previewError ?? "Starting camera..."}
                </Text>
                {previewError && (
                  <Button variant="soft" size="1" onClick={() => setRetryCount((c) => c + 1)}>
                    <MdRefresh size={14} />
                    Retry
                  </Button>
                )}
              </Flex>
            )}
          </div>

          <Flex direction="column" gap="3">
            <Flex align="center" gap="3">
              <Text size="2" style={{ minWidth: 60 }}>Camera</Text>
              <Select.Root value={localCameraID} onValueChange={setLocalCameraID}>
                <Select.Trigger variant="soft" style={{ flex: 1 }} />
                <Select.Content position="popper" sideOffset={4}>
                  {devices.length === 0 ? (
                    <Select.Item value="__none__" disabled>No cameras found</Select.Item>
                  ) : (
                    devices.map((d, i) => (
                      <Select.Item key={d.deviceId || i} value={d.deviceId || `device-${i}`}>
                        {d.label || `Camera ${i + 1}`}
                      </Select.Item>
                    ))
                  )}
                </Select.Content>
              </Select.Root>
            </Flex>

            <Flex align="center" gap="3">
              <Text size="2" style={{ minWidth: 60 }}>Quality</Text>
              <Select.Root value={localQuality} onValueChange={setLocalQuality}>
                <Select.Trigger variant="soft" style={{ flex: 1 }} />
                <Select.Content position="popper" sideOffset={4} style={{ maxHeight: 300 }}>
                  {filteredOptions.map((o) => (
                    <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

            <Text as="label" size="2" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <Checkbox size="1" checked={localFlipped} onCheckedChange={(v) => setLocalFlipped(v === true)} />
              Flip camera (affects what everyone sees)
            </Text>

            <Text as="label" size="2" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <Checkbox size="1" checked={localMirrored} onCheckedChange={(v) => setLocalMirrored(v === true)} />
              Mirror preview
            </Text>
          </Flex>

          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={handleClose}>
              Cancel
            </Button>
            <Button onClick={handleStart} disabled={!previewStream}>
              Start Camera
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
