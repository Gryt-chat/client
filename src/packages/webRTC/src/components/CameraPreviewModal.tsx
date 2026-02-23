import { Button, Checkbox, Dialog, Flex, IconButton, Select, Text } from "@radix-ui/themes";
import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MdClose, MdVideocam } from "react-icons/md";

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
  onStart: () => void;
}

const QUALITY_OPTIONS: { value: CameraQuality; label: string }[] = [
  { value: "720p", label: "720p" },
  { value: "480p", label: "480p" },
  { value: "360p", label: "360p" },
];

const QUALITY_CONSTRAINTS: Record<string, { width: number; height: number; frameRate: number }> = {
  "720p": { width: 1280, height: 720, frameRate: 30 },
  "480p": { width: 854, height: 480, frameRate: 30 },
  "360p": { width: 640, height: 360, frameRate: 30 },
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
  onStart,
}: CameraPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [localCameraID, setLocalCameraID] = useState(cameraID);
  const [localQuality, setLocalQuality] = useState(quality);
  const [localMirrored, setLocalMirrored] = useState(mirrored);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (open) {
      setLocalCameraID(cameraID);
      setLocalQuality(quality);
      setLocalMirrored(mirrored);
    }
  }, [open, cameraID, quality, mirrored]);

  const startPreview = useCallback(async (deviceId: string, q: string) => {
    const qc = QUALITY_CONSTRAINTS[q] ?? QUALITY_CONSTRAINTS["720p"];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: qc.width },
          height: { ideal: qc.height },
          frameRate: { ideal: qc.frameRate },
        },
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

  useEffect(() => {
    if (videoRef.current && previewStream) {
      videoRef.current.srcObject = previewStream;
    }
  }, [previewStream]);

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
                transform: localMirrored ? "scaleX(-1)" : undefined,
              }}
            />
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
                    <RotateCw size={14} />
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
                <Select.Content>
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
                <Select.Content>
                  {QUALITY_OPTIONS.map((o) => (
                    <Select.Item key={o.value} value={o.value}>{o.label}</Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Flex>

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
