import { Alert, Divider, IconButton, Select, type SelectOption, Slider, Tabs, Tooltip } from "@gryt/ui";
import { useMicrophone, useScreenShare, useSpeakers } from "@gryt/voice";
import { useSFU } from "@gryt/voice";
import { voiceLog } from "@gryt/voice";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useTranslation } from "@/i18n";
import { MAX_VOLUME_PERCENT } from "@/lib/audioVolume";
import { setNotificationOutputDevice } from "@/lib/notificationSound";
import { useSettings } from "@/settings";

import { PiArrowsClockwiseFill, PiWarningFill } from "../../../../lib/icons";
import { SettingGroup, SettingsContainer, SliderSetting, ToggleSetting } from "./settingsComponents";

/** Visualizer refresh rate. 30 fps is plenty for a level meter. */
const VISUALIZER_INTERVAL_MS = 33;

/**
 * Smoothing for the level indicator: an exponential moving average per sample.
 * Attack is fast so peaks show; release is slow so it does not flicker.
 */
const LEVEL_ATTACK = 0.6;
const LEVEL_RELEASE = 0.1;

/**
 * Interpolates between the 33 ms samples. Below the sample interval so the
 * indicator stays in step, and linear because an eased restart reads as stutter.
 */
const LEVEL_TRANSITION = "60ms linear";

/**
 * Drops options that repeat an id already in the list. The platform hands us a
 * device literally called "default" alongside the real one, colliding on key.
 */
function dedupeByValue(options: SelectOption[]): SelectOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = String(option.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function AudioSettings() {
  const { t: tr } = useTranslation();
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
    micSilentWarningDismissed,
    setMicSilentWarningDismissed,
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

  // Smoothed copy of micRawVolume, for drawing only. The raw value drives the
  // gate status text, which has to stay truthful.
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

        // Rises quickly toward a peak, falls away slowly. Tracked in a ref so the
        // next sample continues from what was drawn, not what React committed.
        const previous = micDisplayRef.current;
        const weight = rawLevel > previous ? LEVEL_ATTACK : LEVEL_RELEASE;
        const smoothed = previous + (rawLevel - previous) * weight;

        micDisplayRef.current = smoothed;
        setMicDisplayVolume(smoothed);
      }

      // The monitor tap, not finalAnalyser: the meter shows what your processing
      // does to your voice, which has nothing to do with being muted.
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
      <h2>{tr("ui.audio")}</h2>

      {/* First, because it decides what the rest of this section even shows:
          push to talk hides the noise gate below. It used to live further down
          the page in another section, so choosing it made the gate vanish with
          no visible cause. */}
      <SettingGroup anchorId="input-mode"
        title={tr("ui.inputMode")}
        description={tr("ui.voiceActivityTransmitsWheneverYouSpeakAboveThe")}
      >
        <Tabs
          value={inputMode}
          onValueChange={(v) =>
            setInputMode(v as "voice_activity" | "push_to_talk")
          }
        >
          {/* max-[339px]: tighter padding closes the 26px overflow at the
              300px Electron minimum without wrapping the sliding indicator. */}
          <Tabs.List aria-label={tr("ui.inputMode")} className="max-[339px]:gap-0.5">
            <Tabs.Tab value="voice_activity" className="max-[339px]:px-2">
              {tr("ui.voiceActivity")}
            </Tabs.Tab>
            <Tabs.Tab value="push_to_talk" className="max-[339px]:px-2">
              {tr("ui.pushToTalk")}
            </Tabs.Tab>
            <Tabs.Indicator />
          </Tabs.List>
        </Tabs>
      </SettingGroup>

      <Divider />

      {!audioContext && (
        <Alert severity="warning"><span className="inline-flex items-start gap-2"><PiWarningFill size={16} />{tr("ui.microphoneIsInitializingAudioLevelsAndNoiseGate")}</span></Alert>
      )}

      {/* ── Devices ── */}
      <span className="font-bold text-gryt-muted">{tr("ui.devices")}</span>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">{tr("ui.microphone")}</span>
          <Tooltip title={tr("ui.refreshDeviceList")}>
            <IconButton tone="neutral" size="xsmall" onClick={getDevices}>
              <PiArrowsClockwiseFill size={12} />
            </IconButton>
          </Tooltip>
        </div>
        <Select
          value={micID || ""}
          onValueChange={(v) => setMicID(String(v))}
          placeholder={tr("ui.selectMicrophoneDevice")}
          options={dedupeByValue(
            devices.map((device, index) => ({
              label: device.label || tr("audio.microphoneDevice", { id: device.deviceId.slice(0, 8) }),
              // Before the permission prompt is answered every device comes back
              // with an empty id and label, so the label is no better a key.
              value: device.deviceId || `microphone-${index}`,
            })),
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-medium">{tr("ui.speaker")}</span>
          <Tooltip title={tr("ui.refreshDeviceList")}>
            <IconButton tone="neutral" size="xsmall" onClick={getOutputDevices}>
              <PiArrowsClockwiseFill size={12} />
            </IconButton>
          </Tooltip>
        </div>
        <Select
          value={outputDeviceID || "default"}
          onValueChange={(v) => handleOutputDeviceChange(String(v))}
          placeholder={tr("ui.selectOutputDevice")}
          options={dedupeByValue([
            { label: tr("ui.default"), value: "default" },
            ...outputDevices.map((device, index) => ({
              label: device.label || tr("audio.speakerDevice", { id: device.deviceId.slice(0, 8) }),
              value: device.deviceId || `speaker-${index}`,
            })),
          ])}
        />
      </div>

      <Divider />

      {/* ── Input ── */}
      <span className="font-bold text-gryt-muted">{tr("ui.input")}</span>

      <SliderSetting
        anchorId="microphone-volume" title={tr("audio.microphoneVolume", { value: micVolume })}
        description={tr("ui.yourMicrophoneInputLevel100Unchanged2002x")}
        value={micVolume}
        onChange={setMicVolume}
        max={MAX_VOLUME_PERCENT}
      />

      {audioContext && (
        <div className="flex flex-col gap-2">
          <span className="font-medium">{tr("ui.audioLevels")}</span>
          <div className="flex flex-col gap-1">
            <span className="text-gryt-muted">{tr("ui.audioSpectrumRawInput")}</span>
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
              {tr("ui.status")} {audioContext ? tr("ui.active") : tr("ui.inactive")}
              {loopbackEnabled && ` | ${tr("audio.playbackOn")}`}
            </span>
          </div>
        </div>
      )}

      {!isPTT && <div className="flex flex-col gap-2">
        <span className="font-medium">
          {tr("ui.noiseGate")} {noiseGate}%
        </span>
        <span className="text-gryt-muted">
          {tr("ui.audioBelowThisLevelWillBeMutedThe")}
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
            {tr("ui.rawInput")} {Math.round(micRawVolume)}{tr("ui.processed")} {Math.round(micLiveVolume)}%
          </span>
          <span className="font-medium" color={micRawVolume < noiseGate ? "red" : isMicLive ? "green" : "gray"}>
            {micRawVolume < noiseGate ? tr("ui.gated") : isMicLive ? tr("ui.open") : tr("ui.quiet")}
          </span>
        </div>

        <div className="flex flex-col gap-1 mt-2">
          <span className="font-medium">
            {tr("ui.release")} {noiseGateRelease} ms
          </span>
          <span className="text-gryt-muted">
            {tr("ui.howLongTheGateStaysOpenAfterYour")}
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

      <ToggleSetting anchorId="test-microphone"
        title={tr("ui.testMicrophone")}
        description={tr("ui.hearYourselfThroughYourSpeakersOrHeadphonesTo")}
        checked={loopbackEnabled}
        onCheckedChange={handleLoopbackChange}
      />

      <Divider />

      {/* ── Voice Processing ── */}
      <span className="font-bold text-gryt-muted">{tr("ui.voiceProcessing")}</span>

      <ToggleSetting anchorId="noise-reduction"
        title={tr("ui.noiseReduction")}
        description={tr("ui.removesBackgroundNoiseBeforeYourVoiceIsSent")}
        checked={rnnoiseEnabled}
        onCheckedChange={setRnnoiseEnabled}
        statusText={rnnoiseEnabled
          ? tr("audio.rnnoiseActive")
          : undefined
        }
      />

      <ToggleSetting anchorId="auto-gain"
        title={tr("ui.autoGain")}
        description={tr("ui.bringsYourMicrophoneToATargetVolumeQuiet")}
        checked={autoGainEnabled}
        onCheckedChange={setAutoGainEnabled}
        statusText={autoGainEnabled
          ? tr("audio.autoGainActive")
          : undefined
        }
      />

      {autoGainEnabled && (
        <SliderSetting
          anchorId="target-level" title={tr("audio.targetLevel", { value: autoGainTargetDb })}
          description={tr("ui.theVolumeYourVoiceIsBroughtToLower")}
          value={autoGainTargetDb}
          onChange={setAutoGainTargetDb}
          min={-30}
          max={-5}
          step={1}
        />
      )}

      <ToggleSetting anchorId="compressor"
        title={tr("ui.compressor")}
        description={tr("ui.narrowsTheGapBetweenYourQuietestAndLoudest")}
        checked={compressorEnabled}
        onCheckedChange={setCompressorEnabled}
        statusText={compressorEnabled
          ? tr("audio.compressorActive")
          : undefined
        }
      />

      {compressorEnabled && (
        <SliderSetting
          anchorId="compression-amount" title={tr("audio.compressionAmount", { value: compressorAmount })}
          description={tr("ui.howAggressivelyToCompressLowSubtleLevelingHigh")}
          value={compressorAmount}
          onChange={setCompressorAmount}
        />
      )}

      {/* The way back from the toast's "Don't show again". Reads as the warning
          rather than as the dismissal, so the switch is on by default and the
          stored flag is inverted here. */}
      <ToggleSetting anchorId="warn-me-when-my-microphone-goes-silent"
        title={tr("ui.warnMeWhenMyMicrophoneGoesSilent")}
        description={tr("ui.saysSoIfYourMicrophoneStopsSendingAnything")}
        checked={!micSilentWarningDismissed}
        onCheckedChange={(enabled) => setMicSilentWarningDismissed(!enabled)}
      />

      <Divider />

      {/* ── Output ── */}
      <span className="font-bold text-gryt-muted">{tr("ui.output")}</span>

      <SliderSetting
        anchorId="output-volume" title={tr("audio.outputVolume", { value: outputVolume })}
        description={tr("ui.volumeOfAllIncomingAudio100Unchanged200")}
        value={outputVolume}
        onChange={setOutputVolume}
        max={MAX_VOLUME_PERCENT}
      />

      <Divider />

      {/* ── Screen Share ── */}
      <span className="font-bold text-gryt-muted">{tr("ui.screenShareVariant")}</span>

      {nativeAudioActive && (
        <Alert severity="success">{tr("ui.nativeAudioCaptureIsActiveGrytVoicesAre")}</Alert>
      )}

    </SettingsContainer>
  );
}
