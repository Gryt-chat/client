import { ReloadIcon } from "@radix-ui/react-icons";
import {
  Button,
  Flex,
  IconButton,
  Slider,
  Switch,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { FiPlay, FiSquare } from "react-icons/fi";
import useSound from "use-sound";

interface SoundSettingsProps {
  label: string;
  description: string;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  defaultVolume: number;
  customSoundFile: string | null;
  onCustomSoundFileChange: (file: string | null) => void;
  defaultSoundSrc: string;
  showAlert: (
    type: "success" | "error",
    title: string,
    message: string,
  ) => void;
}

export function SoundSettings({
  label,
  description,
  enabled,
  onEnabledChange,
  volume,
  onVolumeChange,
  defaultVolume,
  customSoundFile,
  onCustomSoundFileChange,
  defaultSoundSrc,
  showAlert,
}: SoundSettingsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const [playSound, { stop: stopSound }] = useSound(
    customSoundFile || defaultSoundSrc,
    {
      volume: volume / 100,
      soundEnabled: true,
      interrupt: false,
      onplay: () => setIsPlaying(true),
      onend: () => setIsPlaying(false),
      onstop: () => setIsPlaying(false),
      onloaderror: () => setIsPlaying(false),
      onplayerror: () => setIsPlaying(false),
    },
  );

  useEffect(() => {
    return () => {
      try {
        stopSound();
      } catch (error) {
        console.error(`Error stopping ${label} sound on unmount:`, error);
      }
    };
  }, [stopSound, label]);

  useEffect(() => {
    if (!customSoundFile) return;

    const isBlobUrl = (url: string) => url.startsWith("blob:");
    const isDataUrl = (url: string) => url.startsWith("data:");

    const validate = (): Promise<boolean> =>
      new Promise((resolve) => {
        if (isBlobUrl(customSoundFile)) {
          resolve(false);
          return;
        }

        if (
          !isDataUrl(customSoundFile) &&
          !customSoundFile.startsWith("/") &&
          !customSoundFile.startsWith("./")
        ) {
          resolve(false);
          return;
        }

        const audio = new Audio();
        const timeoutId = setTimeout(() => resolve(false), 5000);

        audio.oncanplaythrough = () => {
          clearTimeout(timeoutId);
          resolve(true);
        };

        audio.onerror = () => {
          clearTimeout(timeoutId);
          resolve(false);
        };

        audio.onabort = () => {
          clearTimeout(timeoutId);
          resolve(false);
        };

        try {
          audio.src = customSoundFile;
          audio.load();
        } catch (error) {
          clearTimeout(timeoutId);
          console.error("Error setting sound src:", error);
          resolve(false);
        }
      });

    validate().then((isValid) => {
      if (!isValid) onCustomSoundFileChange(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const maxSizeBytes = 1024 * 1024;
    if (file.size > maxSizeBytes) {
      showAlert(
        "error",
        "File Too Large",
        `Please choose a file smaller than 1MB.\nYour file: ${(file.size / 1024 / 1024).toFixed(2)}MB`,
      );
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        try {
          onCustomSoundFileChange(dataUrl);
          showAlert(
            "success",
            "Sound File Saved",
            `${label} sound file saved successfully`,
          );
        } catch (error) {
          console.error(`Error saving ${label} sound file:`, error);
          showAlert(
            "error",
            "Error Saving Sound File",
            "Error saving sound file. Please try a smaller file.",
          );
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const resetSound = () => {
    if (isPlaying) stopSound();
    onCustomSoundFileChange(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetVolume = () => onVolumeChange(defaultVolume);

  const testSound = () => {
    try {
      playSound();
    } catch (error) {
      console.error(`Error playing ${label} sound:`, error);
      setIsPlaying(false);
    }
  };

  const stopSoundTest = () => {
    try {
      stopSound();
    } catch (error) {
      console.error(`Error stopping ${label} sound:`, error);
      setIsPlaying(false);
    }
  };

  return (
    <Flex direction="column" gap="3">
      <Text weight="medium" size="3">
        {label}
      </Text>

      <Flex align="center" justify="between">
        <Text size="2" color="gray">
          {description}
        </Text>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </Flex>

      {enabled && (
        <>
          {/* Volume */}
          <Flex direction="column" gap="2">
            <Flex align="center" justify="between">
              <Text weight="medium" size="2">
                Volume
              </Text>
              <Flex gap="1">
                <Tooltip
                  content={`Reset to default (${defaultVolume}%)`}
                  side="top"
                >
                  <IconButton
                    size="1"
                    variant="ghost"
                    color={volume !== defaultVolume ? "red" : "gray"}
                    onClick={resetVolume}
                    disabled={volume === defaultVolume}
                  >
                    <ReloadIcon />
                  </IconButton>
                </Tooltip>
              </Flex>
            </Flex>
            <Flex align="center" gap="2">
              <Slider
                min={0}
                max={100}
                value={[volume]}
                onValueChange={(value) => {
                  if (!Number.isNaN(value[0])) {
                    onVolumeChange(Math.min(100, Math.max(0, value[0])));
                  }
                }}
              />
              <Text style={{ minWidth: "36px" }} size="2">
                {volume}%
              </Text>
            </Flex>
          </Flex>

          {/* Custom Sound File */}
          <Flex direction="column" gap="2">
            <Flex align="center" justify="between">
              <Text weight="medium" size="2">
                Custom Sound File
              </Text>
              <Tooltip content="Reset to default sound" side="top">
                <IconButton
                  size="1"
                  variant="ghost"
                  color={customSoundFile ? "red" : "gray"}
                  onClick={resetSound}
                  disabled={!customSoundFile}
                >
                  <ReloadIcon />
                </IconButton>
              </Tooltip>
            </Flex>
            <Flex align="center" gap="2">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
              <Button
                variant="soft"
                onClick={() => fileInputRef.current?.click()}
                style={{ flexGrow: 1 }}
              >
                {customSoundFile ? "Change File" : "Choose File"}
              </Button>
              <Tooltip content="Test sound" side="top">
                {isPlaying ? (
                  <Button
                    variant="ghost"
                    size="2"
                    onClick={stopSoundTest}
                    color="red"
                  >
                    <FiSquare />
                  </Button>
                ) : (
                  <Button variant="ghost" size="2" onClick={testSound}>
                    <FiPlay />
                  </Button>
                )}
              </Tooltip>
            </Flex>
            {customSoundFile && (
              <Text size="1" color="green">
                ✓ Custom sound file loaded
              </Text>
            )}
          </Flex>
        </>
      )}
    </Flex>
  );
}
