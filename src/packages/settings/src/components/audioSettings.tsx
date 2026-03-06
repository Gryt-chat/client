import {
  Callout,
  Flex,
  Heading,
  IconButton,
  Select,
  Separator,
  Slider,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MdRefresh, MdWarning } from "react-icons/md";

import { useMicrophone, useScreenShare, useSpeakers } from "@/audio";
import { setNotificationOutputDevice } from "@/lib/notificationSound";
import { useSettings } from "@/settings";
import { useSFU } from "@/webRTC";
import { voiceLog } from "@/webRTC/src/hooks/voiceLogger";

import { SettingsContainer, SliderSetting, ToggleSetting } from "./settingsComponents";

export function AudioSettings() {
  const {
    micID,
    setMicID,
    outputDeviceID,
    setOutputDeviceID,
    micVolume,
    setMicVolume,
    outputVolume,
    setOutputVolume,
    noiseGate,
    setNoiseGate,
    noiseGateRelease,
    setNoiseGateRelease,
    setLoopbackEnabled,
    loopbackEnabled,
    rnnoiseEnabled,
    setRnnoiseEnabled,
    autoGainEnabled,
    setAutoGainEnabled,
    autoGainTargetDb,
    setAutoGainTargetDb,
    compressorEnabled,
    setCompressorEnabled,
    compressorAmount,
    setCompressorAmount,
    isMuted,
    setIsMuted,
    inputMode,
  } = useSettings();

  const { isConnected } = useSFU();
  const { devices, microphoneBuffer, getDevices, audioContext } = useMicrophone(true);
  const { devices: outputDevices, getOutputDevices, applyOutputDevice } = useSpeakers();
  const { nativeAudioActive } = useScreenShare();

  const muteStateBeforeLoopback = useRef<boolean | null>(null);

  const handleOutputDeviceChange = useCallback((id: string) => {
    setOutputDeviceID(id);
    applyOutputDevice(id);
    setNotificationOutputDevice(id);
  }, [setOutputDeviceID, applyOutputDevice]);

  const handleLoopbackChange = useCallback((enabled: boolean) => {
    voiceLog.divider(enabled ? "LOOPBACK ON" : "LOOPBACK OFF");
    voiceLog.step("LOOPBACK", 0, "Toggle requested", {
      enabled,
      isConnected,
      isMuted,
      hasAudioContext: !!audioContext,
      contextState: audioContext?.state,
      hasFinalAnalyser: !!microphoneBuffer.finalAnalyser,
      hasMuteGain: !!microphoneBuffer.muteGain,
      muteGainValue: microphoneBuffer.muteGain?.gain.value,
      noiseGateValue: microphoneBuffer.noiseGate?.gain.value,
      volumeGainValue: microphoneBuffer.volumeGain?.gain.value,
    });

    if (enabled) {
      muteStateBeforeLoopback.current = isMuted;
      setLoopbackEnabled(true);
      if (isConnected && !isMuted) {
        voiceLog.warn("LOOPBACK", "Auto-muting because connected to SFU");
        setIsMuted(true);
      }
    } else {
      setLoopbackEnabled(false);
    }
  }, [setLoopbackEnabled, isConnected, isMuted, setIsMuted, audioContext, microphoneBuffer]);

  useEffect(() => {
    if (loopbackEnabled || muteStateBeforeLoopback.current === null) return;
    voiceLog.info("LOOPBACK", "Restoring mute state", { was: muteStateBeforeLoopback.current });
    setIsMuted(muteStateBeforeLoopback.current);
    muteStateBeforeLoopback.current = null;
  }, [loopbackEnabled, setIsMuted]);

  useEffect(() => {
    if (!loopbackEnabled) return;
    const id = setInterval(() => {
      const buf = microphoneBuffer;
      const muteVal = buf.muteGain?.gain.value ?? null;
      const gateVal = buf.noiseGate?.gain.value ?? null;
      const volVal = buf.volumeGain?.gain.value ?? null;

      let finalRms: number | null = null;
      if (buf.finalAnalyser) {
        const len = buf.finalAnalyser.frequencyBinCount;
        const arr = new Uint8Array(len);
        buf.finalAnalyser.getByteFrequencyData(arr);
        let sum = 0;
        for (let i = 0; i < len; i++) sum += arr[i] * arr[i];
        finalRms = Math.sqrt(sum / len);
      }

      let rawRms: number | null = null;
      if (buf.analyser) {
        const len = buf.analyser.frequencyBinCount;
        const arr = new Uint8Array(len);
        buf.analyser.getByteFrequencyData(arr);
        let sum = 0;
        for (let i = 0; i < len; i++) sum += arr[i] * arr[i];
        rawRms = Math.sqrt(sum / len);
      }

      voiceLog.info("LOOPBACK", "Periodic diagnostic", {
        contextState: audioContext?.state,
        muteGain: muteVal,
        noiseGate: gateVal,
        volumeGain: volVal,
        agcGain: buf.agcGain?.gain.value ?? null,
        rawRms: rawRms !== null ? Math.round(rawRms * 10) / 10 : null,
        finalRms: finalRms !== null ? Math.round(finalRms * 10) / 10 : null,
      });
    }, 2000);
    return () => clearInterval(id);
  }, [loopbackEnabled, microphoneBuffer, audioContext]);

  const getRawVisualizerData = useCallback((): Uint8Array | null => {
    if (!microphoneBuffer.analyser) {
      return null;
    }

    const bufferLength = microphoneBuffer.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    microphoneBuffer.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }, [microphoneBuffer.analyser]);

  const [micLiveVolume, setMicLiveVolume] = useState(0);
  const [micRawVolume, setMicRawVolume] = useState(0);
  const [isMicLive, setIsMicLive] = useState(false);
  const [visualizerData, setVisualizerData] = useState<Uint8Array | null>(null);
  const devicesLoadedRef = useRef(false);

  useEffect(() => {
    if (!devicesLoadedRef.current) {
      devicesLoadedRef.current = true;
      getDevices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (devices.length > 0 && !micID) {
      const firstDevice = devices[0];
      setMicID(firstDevice.deviceId);
    }
  }, [devices, micID, setMicID]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (microphoneBuffer.analyser) {
        const bufferLength = microphoneBuffer.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        microphoneBuffer.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const rawVolume = (rms / 255) * 100;

        setMicRawVolume(rawVolume);
        const speaking = rawVolume > noiseGate;
        setIsMicLive(speaking);
      }

      if (microphoneBuffer.finalAnalyser) {
        const bufferLength = microphoneBuffer.finalAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        microphoneBuffer.finalAnalyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const finalVolume = (rms / 255) * 100;

        setMicLiveVolume(finalVolume);

        const vizData = getRawVisualizerData();
        setVisualizerData(vizData);
      }
    }, 16);

    return () => {
      clearInterval(interval);
      setVisualizerData(null);
    };
  }, [microphoneBuffer.analyser, microphoneBuffer.finalAnalyser, noiseGate, getRawVisualizerData]);

  const AudioVisualizer = useMemo(() => {
    return () => {
      if (!visualizerData) return null;

      const bars = Array.from(visualizerData.slice(0, 32)).map((value, index) => {
        const height = Math.max(2, (value / 255) * 40);
        const isAboveThreshold = micRawVolume > noiseGate;
        return (
          <div
            key={index}
            style={{
              width: '3px',
              height: `${height}px`,
              backgroundColor: isAboveThreshold ? 'var(--green-9)' : 'var(--gray-9)',
              marginRight: '1px',
              borderRadius: '1px',
              transition: 'height 0.1s ease-out, background-color 0.1s ease-out',
            }}
          />
        );
      });

      return (
        <Flex align="end" gap="0" style={{ height: '40px', padding: '4px' }}>
          {bars}
        </Flex>
      );
    };
  }, [visualizerData, micRawVolume, noiseGate]);

  const isPTT = inputMode === "push_to_talk";

  return (
    <SettingsContainer>
      <Heading size="4">Audio Settings</Heading>

      {!audioContext && (
        <Callout.Root color="orange">
          <Callout.Icon>
            <MdWarning size={16} />
          </Callout.Icon>
          <Callout.Text>
            Microphone is initializing. Audio levels and noise gate will be visible once ready.
          </Callout.Text>
        </Callout.Root>
      )}

      {/* ── Devices ── */}
      <Text size="3" weight="bold" color="gray">Devices</Text>

      <Flex direction="column" gap="2">
        <Flex align="center" justify="between">
          <Text weight="medium" size="2">Microphone</Text>
          <Tooltip content="Refresh device list">
            <IconButton variant="soft" size="1" onClick={getDevices}>
              <MdRefresh size={12} />
            </IconButton>
          </Tooltip>
        </Flex>
        <Select.Root value={micID || ""} onValueChange={setMicID}>
          <Select.Trigger placeholder="Select microphone device" />
          <Select.Content position="popper" sideOffset={4}>
            {devices.map((device) => (
              <Select.Item key={device.deviceId || device.label} value={device.deviceId || `device-${device.label}`}>
                {device.label || `Microphone ${device.deviceId.slice(0, 8)}`}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      <Flex direction="column" gap="2">
        <Flex align="center" justify="between">
          <Text weight="medium" size="2">Speaker</Text>
          <Tooltip content="Refresh device list">
            <IconButton variant="soft" size="1" onClick={getOutputDevices}>
              <MdRefresh size={12} />
            </IconButton>
          </Tooltip>
        </Flex>
        <Select.Root value={outputDeviceID || "default"} onValueChange={handleOutputDeviceChange}>
          <Select.Trigger placeholder="Select output device" />
          <Select.Content position="popper" sideOffset={4}>
            <Select.Item value="default">Default</Select.Item>
            {outputDevices.map((device) => (
              <Select.Item key={device.deviceId || device.label} value={device.deviceId || `device-${device.label}`}>
                {device.label || `Speaker ${device.deviceId.slice(0, 8)}`}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      <Separator size="4" />

      {/* ── Input ── */}
      <Text size="3" weight="bold" color="gray">Input</Text>

      <SliderSetting
        title={`Microphone Volume: ${micVolume}%`}
        description="Your microphone input level (50% = normal volume, 100% = 2x boost)"
        value={micVolume}
        onChange={setMicVolume}
      />

      {audioContext && (
        <Flex direction="column" gap="2">
          <Text weight="medium" size="2">Audio Levels</Text>
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">Audio Spectrum (Raw Input)</Text>
            <div style={{
              border: '1px solid var(--gray-6)',
              borderRadius: '4px',
              padding: '4px',
              backgroundColor: 'var(--gray-3)',
              minHeight: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <AudioVisualizer />
            </div>
          </Flex>
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              Status: {audioContext ? "Active" : "Inactive"}
              {loopbackEnabled && " | Playback on"}
            </Text>
          </Flex>
        </Flex>
      )}

      {!isPTT && <Flex direction="column" gap="2">
        <Text weight="medium" size="2">
          Noise Gate: {noiseGate}%
        </Text>
        <Text size="1" color="gray">
          Audio below this level will be muted. The indicator shows your raw microphone input level.
        </Text>

        <div style={{ position: 'relative' }}>
          <Slider
            value={[noiseGate]}
            onValueChange={(value) => setNoiseGate(value[0])}
            max={100}
            min={0}
            step={1}
            style={{ position: 'relative', zIndex: 2 }}
          />

          {audioContext && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: `${micRawVolume}%`,
                transform: 'translate(-50%, -50%)',
                width: '3px',
                height: '20px',
                backgroundColor: isMicLive ? 'var(--green-9)' : 'var(--gray-9)',
                borderRadius: '2px',
                zIndex: 3,
                pointerEvents: 'none',
                transition: 'left 0.1s ease-out, background-color 0.1s ease-out',
              }}
            />
          )}

          {audioContext && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '0',
                transform: 'translateY(-50%)',
                width: `${micRawVolume}%`,
                height: '8px',
                backgroundColor: isMicLive ? 'var(--green-a4)' : 'var(--gray-a4)',
                borderRadius: '4px',
                zIndex: 1,
                pointerEvents: 'none',
                transition: 'width 0.1s ease-out, background-color 0.1s ease-out',
              }}
            />
          )}
        </div>

        <Flex align="center" justify="between">
          <Text size="1" color="gray">
            Raw Input: {Math.round(micRawVolume)}% | Processed: {Math.round(micLiveVolume)}%
          </Text>
          <Text
            size="1"
            color={micRawVolume < noiseGate ? "red" : isMicLive ? "green" : "gray"}
            weight="medium"
          >
            {micRawVolume < noiseGate ? "GATED" : isMicLive ? "OPEN" : "QUIET"}
          </Text>
        </Flex>

        <Flex direction="column" gap="1" mt="2">
          <Text weight="medium" size="2">
            Release: {noiseGateRelease} ms
          </Text>
          <Text size="1" color="gray">
            How long the gate stays open after your voice drops below the threshold.
          </Text>
          <Slider
            value={[noiseGateRelease]}
            onValueChange={(value) => setNoiseGateRelease(value[0])}
            max={1000}
            min={0}
            step={10}
          />
        </Flex>
      </Flex>}

      <ToggleSetting
        title="Test Microphone (Playback)"
        description="Hear yourself through speakers/headphones. Useful for verifying your audio processing settings."
        checked={loopbackEnabled}
        onCheckedChange={handleLoopbackChange}
      />

      <Separator size="4" />

      {/* ── Voice Processing ── */}
      <Text size="3" weight="bold" color="gray">Voice Processing</Text>

      <ToggleSetting
        title="Noise Reduction (RNNoise)"
        description="AI-powered noise reduction. Processes audio off the main thread via AudioWorklet for low-latency noise suppression (~20 ms)."
        checked={rnnoiseEnabled}
        onCheckedChange={setRnnoiseEnabled}
        statusText={rnnoiseEnabled
          ? "RNNoise is active — background noise will be filtered"
          : undefined
        }
      />

      <ToggleSetting
        title="Auto Gain"
        description="Normalizes your microphone to a target volume level. Quiet speech gets boosted, loud speech gets reduced."
        checked={autoGainEnabled}
        onCheckedChange={setAutoGainEnabled}
        statusText={autoGainEnabled
          ? "Auto gain is active — your voice will be normalized to the target level"
          : undefined
        }
      />

      {autoGainEnabled && (
        <SliderSetting
          title={`Target Level: ${autoGainTargetDb} dB`}
          description="The volume level your voice will be normalized to. Lower values = quieter output, higher = louder."
          value={autoGainTargetDb}
          onChange={setAutoGainTargetDb}
          min={-30}
          max={-5}
          step={1}
        />
      )}

      <ToggleSetting
        title="Compressor"
        description="Reduces dynamic range so your volume stays more consistent. Tames peaks and evens out your voice after auto gain."
        checked={compressorEnabled}
        onCheckedChange={setCompressorEnabled}
        statusText={compressorEnabled
          ? "Compressor is active — dynamic peaks will be tamed"
          : undefined
        }
      />

      {compressorEnabled && (
        <SliderSetting
          title={`Compression Amount: ${compressorAmount}%`}
          description="How aggressively to compress. Low = subtle leveling, high = heavy squash."
          value={compressorAmount}
          onChange={setCompressorAmount}
        />
      )}

      <Separator size="4" />

      {/* ── Output ── */}
      <Text size="3" weight="bold" color="gray">Output</Text>

      <SliderSetting
        title={`Output Volume: ${outputVolume}%`}
        description="Controls volume of all incoming audio (50% = normal, 100% = 2x boost)"
        value={outputVolume}
        onChange={setOutputVolume}
      />

      <Separator size="4" />

      {/* ── Screen Share ── */}
      <Text size="3" weight="bold" color="gray">Screen Share</Text>

      {nativeAudioActive && (
        <Callout.Root size="1" color="green">
          <Callout.Text>
            Native audio capture is active — Gryt voices are excluded at the OS level.
          </Callout.Text>
        </Callout.Root>
      )}

    </SettingsContainer>
  );
}
