import { Button, Flex, Heading, Select, Separator, Text } from "@radix-ui/themes";
import { RotateCw } from "lucide-react";
import { useEffect, useRef } from "react";

import { useCamera } from "@/audio";
import { useSettings } from "@/settings";

import { SettingsContainer, ToggleSetting } from "./settingsComponents";

const QUALITY_OPTIONS = [
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

  const { cameraStream, cameraEnabled, cameraError, setCameraEnabled, retryCamera, devices, getDevices } = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const wasEnabledRef = useRef(false);

  useEffect(() => {
    getDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start camera for preview when settings tab is opened (only if not already on)
  useEffect(() => {
    wasEnabledRef.current = cameraEnabled;
    if (!cameraEnabled) setCameraEnabled(true);
    return () => {
      if (!wasEnabledRef.current) setCameraEnabled(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach stream to video element
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (cameraStream) {
      el.srcObject = cameraStream;
    } else {
      el.srcObject = null;
    }
  }, [cameraStream]);

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
          {cameraStream ? (
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
              <Text size="2" color={cameraError ? "red" : "gray"}>
                {cameraError ?? "No camera detected"}
              </Text>
              {cameraError && (
                <Button variant="soft" size="1" onClick={retryCamera}>
                  <RotateCw size={14} />
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
