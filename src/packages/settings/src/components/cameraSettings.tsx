import { Button, Flex, Heading, Select, Separator, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { MdRefresh } from "react-icons/md";

import { type CameraQuality, QUALITY_CONSTRAINTS, useCamera } from "@/audio";
import { useSettings } from "@/settings";

import { SettingsContainer, ToggleSetting } from "./settingsComponents";

const QUALITY_OPTIONS = [
  { value: "native", label: "Native (camera default)" },
  { value: "1080p", label: "1080p (1920×1080)" },
  { value: "720p", label: "720p (1280×720)" },
  { value: "480p", label: "480p (854×480)" },
  { value: "360p", label: "360p (640×360)" },
];

export function CameraSettings() {
  const {
    cameraID,
    setCameraID,
    cameraQuality,
    setCameraQuality,
    cameraMirrored,
    setCameraMirrored,
  } = useSettings();

  const { cameraEnabled, cameraStream: globalStream, devices, getDevices } = useCamera();

  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const activeStream = cameraEnabled ? globalStream : previewStream;
  const activeError = cameraEnabled ? null : previewError;

  useEffect(() => {
    getDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPreview = useCallback(async () => {
    if (cameraEnabled) return;
    const quality = QUALITY_CONSTRAINTS[cameraQuality as CameraQuality] ?? QUALITY_CONSTRAINTS.native;
    const videoConstraints: MediaTrackConstraints = {
      ...(cameraID ? { deviceId: { exact: cameraID } } : {}),
      frameRate: { ideal: quality.frameRate },
    };
    if (quality.width) {
      videoConstraints.width = { ideal: quality.width };
      videoConstraints.height = { ideal: quality.height };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      previewStreamRef.current = stream;
      setPreviewStream(stream);
      setPreviewError(null);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      switch (name) {
        case "NotAllowedError":
          setPreviewError("Camera access was denied. Check your browser or system permissions.");
          break;
        case "NotFoundError":
          setPreviewError("No camera detected. Make sure one is connected.");
          break;
        default:
          setPreviewError("Failed to start camera preview. Please try again.");
      }
    }
  }, [cameraEnabled, cameraID, cameraQuality]);

  const stopPreview = useCallback(() => {
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    }
    setPreviewStream(null);
  }, []);

  // Start local preview when the settings tab opens (only if camera isn't already globally on)
  useEffect(() => {
    if (!cameraEnabled) {
      startPreview();
    }
    return () => {
      stopPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restart preview when device or quality changes (only when previewing locally)
  useEffect(() => {
    if (!cameraEnabled && previewStreamRef.current) {
      startPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraID, cameraQuality]);

  // If global camera turns on while previewing, stop the local preview
  useEffect(() => {
    if (cameraEnabled) {
      stopPreview();
    }
  }, [cameraEnabled, stopPreview]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = activeStream ?? null;
  }, [activeStream]);

  return (
    <SettingsContainer>
      <Heading size="4">Camera</Heading>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Preview</Text>
        <Flex
          align="center"
          justify="center"
          style={{
            background: "var(--gray-3)",
            borderRadius: "var(--radius-3)",
            overflow: "hidden",
            aspectRatio: "16/9",
            maxHeight: 280,
          }}
        >
          {activeStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: cameraMirrored ? "scaleX(-1)" : undefined,
              }}
            />
          ) : (
            <Flex direction="column" align="center" gap="2" p="4">
              <Text size="2" color={activeError ? "red" : "gray"}>
                {activeError ?? "No camera detected"}
              </Text>
              {activeError && (
                <Button variant="soft" size="1" onClick={startPreview}>
                  <MdRefresh size={14} />
                  Retry
                </Button>
              )}
            </Flex>
          )}
        </Flex>
      </Flex>

      <Separator size="4" />

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Camera Device</Text>
        <Select.Root
          value={cameraID || ""}
          onValueChange={(value) => setCameraID(value)}
        >
          <Select.Trigger placeholder="Select a camera" />
          <Select.Content>
            {devices.map((device) => (
              <Select.Item key={device.deviceId || device.label} value={device.deviceId || `device-${device.label}`}>
                {device.label || `Camera ${device.deviceId.slice(0, 8)}`}
              </Select.Item>
            ))}
            {devices.length === 0 && (
              <Select.Item value="__none__" disabled>
                No cameras found
              </Select.Item>
            )}
          </Select.Content>
        </Select.Root>
      </Flex>

      <Flex direction="column" gap="2">
        <Text weight="medium" size="2">Video Quality</Text>
        <Select.Root
          value={cameraQuality}
          onValueChange={(value) => setCameraQuality(value)}
        >
          <Select.Trigger />
          <Select.Content>
            {QUALITY_OPTIONS.map((opt) => (
              <Select.Item key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      <ToggleSetting
        title="Mirror Preview"
        description="Mirror your local camera preview (does not affect what others see)"
        checked={cameraMirrored}
        onCheckedChange={setCameraMirrored}
      />
    </SettingsContainer>
  );
}
