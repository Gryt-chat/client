import { Alert, Divider, IconButton, Select, Slider, Tabs, Tooltip } from "@gryt/ui";
import { useMicrophone, useScreenShare, useSpeakers } from "@gryt/voice";
import { useSFU } from "@gryt/voice";
import { voiceLog } from "@gryt/voice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PiArrowsClockwiseFill, PiWarningFill } from "react-icons/pi";

import { MAX_VOLUME_PERCENT } from "@/lib/audioVolume";
import { setNotificationOutputDevice } from "@/lib/notificationSound";
import { useSettings } from "@/settings";

import { SettingGroup, SettingsContainer, SliderSetting, ToggleSetting } from "./settingsComponents";

/** Visualizer refresh rate. 30 fps is plenty for a level meter. */
const VISUALIZER_INTERVAL_MS = 33;

/**
 * Smoothing for the level indicator on the noise gate slider.
 *
 * Speech RMS swings hard between syllables, so drawing raw samples 30 times a
 * second makes the marker jitter enough to be hard to read. These are the
 * weights of an exponential moving average, applied per sample.
 *
 * Attack is fast so a sudden peak still shows up almost immediately — the whole
 * point of the indicator is judging where to put the gate threshold, and a
 * meter that under-reports peaks would have you set it too low. Release is much
 * slower so the indicator falls away smoothly instead of flickering down
 * between words.
 *
 * At these weights and a 33 ms sample: a peak reads at 90 % within ~100 ms,
 * decays to 10 % over ~730 ms, and average frame-to-frame movement against
 * syllable-rate speech drops from about 22 % of the track to about 4 %.
 */
const LEVEL_ATTACK = 0.6;
const LEVEL_RELEASE = 0.1;

/**
 * Interpolates between the 33 ms samples. Kept below the sample interval so the
 * indicator stays roughly in step with the audio rather than trailing it, and
 * linear because an eased curve restarting every sample reads as stutter.
 */
const LEVEL_TRANSITION = "60ms linear";

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
    setInputMode,
  } = useSettings();

  const { isConnected } = useSFU();
  const { devices, microphoneBuffer, getDevices, audioContext, getGateLevel } =
    useMicrophone(true);
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
      // buf.noiseGate is only the fallback node; the real gate is the worklet.
      const gateVal = getGateLevel();
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
  }, [loopbackEnabled, microphoneBuffer, audioContext, getGateLevel]);

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

  // Smoothed copy of micRawVolume, used only for drawing the indicator. The raw
  // value still drives the gate status text, which has to stay truthful — a
  // smoothed reading would show the gate as open a moment after it closed.
  const [micDisplayVolume, setMicDisplayVolume] = useState(0);
  const micDisplayRef = useRef(0);

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
      // Prefer the level the gate itself decided on. Measuring separately here
      // made the meter and the gate disagree, so the threshold looked wrong.
      const gateLevel = getGateLevel();
      let rawLevel: number | null = null;

      if (gateLevel !== null) {
        rawLevel = gateLevel;
      } else if (microphoneBuffer.analyser) {
        const bufferLength = microphoneBuffer.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        microphoneBuffer.analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        rawLevel = (rms / 255) * 100;
      }

      if (rawLevel !== null) {
        setMicRawVolume(Math.round(rawLevel));
        setIsMicLive(rawLevel > noiseGate);

        // Rises quickly toward a peak, falls away slowly. Tracked in a ref so
        // the next sample continues from the value actually drawn rather than
        // from whatever React last committed.
        const previous = micDisplayRef.current;
        const weight = rawLevel > previous ? LEVEL_ATTACK : LEVEL_RELEASE;
        const smoothed = previous + (rawLevel - previous) * weight;

        micDisplayRef.current = smoothed;
        setMicDisplayVolume(smoothed);
      }

      // The monitor tap, not finalAnalyser: the meter should show what your
      // processing is doing to your voice, which is a judgement about levels
      // and has nothing to do with whether you happen to be muted.
      const levelSource =
        microphoneBuffer.monitorAnalyser ?? microphoneBuffer.finalAnalyser;
      if (levelSource) {
        const bufferLength = levelSource.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        levelSource.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const finalVolume = (rms / 255) * 100;

        setMicLiveVolume(Math.round(finalVolume));

        const vizData = getRawVisualizerData();
        setVisualizerData(vizData);
      }
      // 30 fps. At 60 the panel re-rendered every 16 ms, which stutters badly on
      // weaker GPUs, and a level meter gains nothing from the extra frames.
    }, VISUALIZER_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      setVisualizerData(null);
      // Otherwise reopening the panel briefly shows the bar at whatever level
      // it held when it closed, then jumps.
      micDisplayRef.current = 0;
      setMicDisplayVolume(0);
    };
  }, [
    microphoneBuffer.analyser,
    microphoneBuffer.finalAnalyser,
    microphoneBuffer.monitorAnalyser,
    noiseGate,
    getRawVisualizerData,
    getGateLevel,
  ]);

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
              backgroundColor: isAboveThreshold ? 'var(--gryt-success-9)' : 'var(--gryt-neutral-9)',
              marginRight: '1px',
              borderRadius: '1px',
            }}
          />
        );
      });

      return (
        <div className="flex items-end gap-0" style={{ height: '40px', padding: '4px' }}>
          {bars}
        </div>
      );
    };
  }, [visualizerData, micRawVolume, noiseGate]);

  const isPTT = inputMode === "push_to_talk";

  return (
    <SettingsContainer>
      <h2>Audio</h2>

      {/* First, because it decides what the rest of this section even shows:
          push to talk hides the noise gate below. It used to live further down
          the page in another section, so choosing it made the gate vanish with
          no visible cause. */}
      <SettingGroup
        title="Input mode"
        description="Voice activity transmits whenever you speak above the noise gate. Push to talk only transmits while you hold a key, and hides the gate below."
      >
        <Tabs
          value={inputMode}
          onValueChange={(v) =>
            setInputMode(v as "voice_activity" | "push_to_talk")
          }
        >
          <Tabs.List aria-label="Input mode">
            <Tabs.Tab value="voice_activity">Voice activity</Tabs.Tab>
            <Tabs.Tab value="push_to_talk">Push to talk</Tabs.Tab>
            <Tabs.Indicator />
          </Tabs.List>
        </Tabs>
      </SettingGroup>

      <Divider />

      {!audioContext && (
        <Alert severity="warning"><span className="inline-flex items-start gap-2"><PiWarningFill size={16} />Microphone is initializing. Audio levels and noise gate will be visible once ready.</span></Alert>
      )}

      {/* ── Devices ── */}
      <span className="font-bold text-gryt-muted">Devices</span>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">Microphone</span>
          <Tooltip title="Refresh device list">
            <IconButton tone="neutral" size="xsmall" onClick={getDevices}>
              <PiArrowsClockwiseFill size={12} />
            </IconButton>
          </Tooltip>
        </div>
        <Select
          value={micID || ""}
          onValueChange={(v) => setMicID(String(v))}
          placeholder="Select microphone device"
          options={devices.map((device) => ({
            label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
            value: device.deviceId || `device-${device.label}`,
          }))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">Speaker</span>
          <Tooltip title="Refresh device list">
            <IconButton tone="neutral" size="xsmall" onClick={getOutputDevices}>
              <PiArrowsClockwiseFill size={12} />
            </IconButton>
          </Tooltip>
        </div>
        <Select
          value={outputDeviceID || "default"}
          onValueChange={(v) => handleOutputDeviceChange(String(v))}
          placeholder="Select output device"
          options={[
            { label: "Default", value: "default" },
            ...outputDevices.map((device) => ({
              label: device.label || `Speaker ${device.deviceId.slice(0, 8)}`,
              value: device.deviceId || `device-${device.label}`,
            })),
          ]}
        />
      </div>

      <Divider />

      {/* ── Input ── */}
      <span className="font-bold text-gryt-muted">Input</span>

      <SliderSetting
        title={`Microphone volume: ${micVolume}%`}
        description="Your microphone input level (100% = unchanged, 200% = 2x boost)"
        value={micVolume}
        onChange={setMicVolume}
        max={MAX_VOLUME_PERCENT}
      />

      {audioContext && (
        <div className="flex flex-col gap-2">
          <span className="font-medium">Audio Levels</span>
          <div className="flex flex-col gap-1">
            <span className="text-gryt-muted">Audio Spectrum (Raw Input)</span>
            <div style={{
              border: '1px solid var(--gryt-neutral-6)',
              borderRadius: '4px',
              padding: '4px',
              backgroundColor: 'var(--gryt-neutral-3)',
              minHeight: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <AudioVisualizer />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-gryt-muted">
              Status: {audioContext ? "Active" : "Inactive"}
              {loopbackEnabled && " | Playback on"}
            </span>
          </div>
        </div>
      )}

      {!isPTT && <div className="flex flex-col gap-2">
        <span className="font-medium">
          Noise gate: {noiseGate}%
        </span>
        <span className="text-gryt-muted">
          Audio below this level will be muted. The indicator shows your raw microphone input level.
        </span>

        <div style={{ position: 'relative' }}>
          <Slider
            value={noiseGate}
            onValueChange={(next) => setNoiseGate(Number(next))}
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
                left: `${micDisplayVolume}%`,
                transform: 'translate(-50%, -50%)',
                width: '3px',
                height: '20px',
                backgroundColor: isMicLive ? 'var(--gryt-success-9)' : 'var(--gryt-neutral-9)',
                borderRadius: '2px',
                zIndex: 3,
                pointerEvents: 'none',
                transition: `left ${LEVEL_TRANSITION}, background-color 0.1s ease-out`,
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
                width: `${micDisplayVolume}%`,
                height: '8px',
                backgroundColor: isMicLive ? 'color-mix(in oklab, var(--gryt-success-9) 10%, transparent)' : 'var(--gryt-neutral-a4)',
                borderRadius: '4px',
                zIndex: 1,
                pointerEvents: 'none',
                transition: `width ${LEVEL_TRANSITION}, background-color 0.1s ease-out`,
              }}
            />
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-gryt-muted">
            Raw Input: {Math.round(micRawVolume)}% | Processed: {Math.round(micLiveVolume)}%
          </span>
          <span className="font-medium" color={micRawVolume < noiseGate ? "red" : isMicLive ? "green" : "gray"}>
            {micRawVolume < noiseGate ? "GATED" : isMicLive ? "OPEN" : "QUIET"}
          </span>
        </div>

        <div className="flex flex-col gap-1 mt-2">
          <span className="font-medium">
            Release: {noiseGateRelease} ms
          </span>
          <span className="text-gryt-muted">
            How long the gate stays open after your voice drops below the threshold.
          </span>
          <Slider
            value={noiseGateRelease}
            onValueChange={(next) => setNoiseGateRelease(Number(next))}
            max={1000}
            min={0}
            step={10}
          />
        </div>
      </div>}

      <ToggleSetting
        title="Test microphone"
        description="Hear yourself through your speakers or headphones, to check what the processing is doing."
        checked={loopbackEnabled}
        onCheckedChange={handleLoopbackChange}
      />

      <Divider />

      {/* ── Voice Processing ── */}
      <span className="font-bold text-gryt-muted">Voice Processing</span>

      <ToggleSetting
        title="Noise reduction"
        description="Removes background noise before your voice is sent. Runs in an AudioWorklet off the main thread, and adds about 20 ms."
        checked={rnnoiseEnabled}
        onCheckedChange={setRnnoiseEnabled}
        statusText={rnnoiseEnabled
          ? "RNNoise is active — background noise will be filtered"
          : undefined
        }
      />

      <ToggleSetting
        title="Auto gain"
        description="Brings your microphone to a target volume. Quiet speech is boosted, loud speech is reduced."
        checked={autoGainEnabled}
        onCheckedChange={setAutoGainEnabled}
        statusText={autoGainEnabled
          ? "Auto gain is active — your voice will be normalized to the target level"
          : undefined
        }
      />

      {autoGainEnabled && (
        <SliderSetting
          title={`Target level: ${autoGainTargetDb} dB`}
          description="The volume your voice is brought to. Lower is quieter, higher is louder."
          value={autoGainTargetDb}
          onChange={setAutoGainTargetDb}
          min={-30}
          max={-5}
          step={1}
        />
      )}

      <ToggleSetting
        title="Compressor"
        description="Narrows the gap between your quietest and loudest, so your level stays steadier. Runs after auto gain."
        checked={compressorEnabled}
        onCheckedChange={setCompressorEnabled}
        statusText={compressorEnabled
          ? "Compressor is active — dynamic peaks will be tamed"
          : undefined
        }
      />

      {compressorEnabled && (
        <SliderSetting
          title={`Compression amount: ${compressorAmount}%`}
          description="How aggressively to compress. Low = subtle leveling, high = heavy squash."
          value={compressorAmount}
          onChange={setCompressorAmount}
        />
      )}

      <Divider />

      {/* ── Output ── */}
      <span className="font-bold text-gryt-muted">Output</span>

      <SliderSetting
        title={`Output volume: ${outputVolume}%`}
        description="Volume of all incoming audio (100% = unchanged, 200% = 2x boost)"
        value={outputVolume}
        onChange={setOutputVolume}
        max={MAX_VOLUME_PERCENT}
      />

      <Divider />

      {/* ── Screen Share ── */}
      <span className="font-bold text-gryt-muted">Screen Share</span>

      {nativeAudioActive && (
        <Alert severity="success">Native audio capture is active — Gryt voices are excluded at the OS level.</Alert>
      )}

    </SettingsContainer>
  );
}
