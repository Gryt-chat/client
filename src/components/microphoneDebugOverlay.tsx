import { useEffect, useState } from "react";

import { useMicrophone, useVoiceLatency } from "@/audio";
import { useSettings } from "@/settings";
import { useServerManagement,useSockets } from "@/socket";

import { useDeviceEnumeration } from "../packages/audio/src/hooks/useDeviceEnumeration";
import { DebugOverlay } from "./debugOverlay";

interface MicrophoneDebugOverlayProps {
  isVisible: boolean;
}

export function MicrophoneDebugOverlay({ isVisible }: MicrophoneDebugOverlayProps) {
  const { 
    microphoneBuffer, 
    audioContext
  } = useMicrophone(true);
  
  const { devices, isLoading: devicesLoading, error: devicesError } = useDeviceEnumeration();
  const { micID, micVolume, noiseGate, isMuted, isDeafened } = useSettings();
  const { currentlyViewingServer } = useServerManagement();
  const { sockets } = useSockets();
  const { latency, modeLabel } = useVoiceLatency(isVisible);
  
  const [currentDevice, setCurrentDevice] = useState<InputDeviceInfo | null>(null);
  const [rawVolume, setRawVolume] = useState(0);
  const [processedVolume, setProcessedVolume] = useState(0);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);

  const [socketRttMs, setSocketRttMs] = useState<number | null>(null);

  // Find current device info
  useEffect(() => {
    if (micID && devices.length > 0) {
      const device = devices.find((d: InputDeviceInfo) => d.deviceId === micID);
      setCurrentDevice(device || null);
    } else {
      setCurrentDevice(null);
    }
  }, [micID, devices]);

  // Monitor audio levels and transmission status
  useEffect(() => {
    if (!microphoneBuffer.analyser || !microphoneBuffer.finalAnalyser) {
      return;
    }

    const interval = setInterval(() => {
      // Raw audio level (for noise gate detection)
      if (microphoneBuffer.analyser) {
        const bufferLength = microphoneBuffer.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        microphoneBuffer.analyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const rawVol = (rms / 255) * 100;
        setRawVolume(rawVol);
        
        // Check if transmitting (above noise gate)
        setIsTransmitting(rawVol > noiseGate && !isMuted && !isDeafened);
      }

      // Processed audio level (final output)
      if (microphoneBuffer.finalAnalyser) {
        const bufferLength = microphoneBuffer.finalAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        microphoneBuffer.finalAnalyser.getByteFrequencyData(dataArray);
        
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        const processedVol = (rms / 255) * 100;
        setProcessedVolume(processedVol);
        
        // Calculate dB level
        const dbLevel = processedVol > 0 ? 20 * Math.log10(processedVol / 100) : -Infinity;
        setAudioLevel(dbLevel);
      }
    }, 50); // Update 20 times per second

    return () => clearInterval(interval);
  }, [microphoneBuffer.analyser, microphoneBuffer.finalAnalyser, noiseGate, isMuted, isDeafened]);

  // Socket ping RTT (currently viewed server)
  useEffect(() => {
    if (!isVisible) return;
    const host = currentlyViewingServer?.host;
    if (!host) return;
    const socket = sockets[host];
    if (!socket || !socket.connected) return;

    let alive = true;

    const onPong = (payload: { t0: number }) => {
      if (!alive) return;
      const t0 = payload?.t0;
      if (typeof t0 !== "number") return;
      setSocketRttMs(Math.max(0, Date.now() - t0));
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("diagnostics:pong", onPong as any);
    const interval = setInterval(() => {
      const t0 = Date.now();
      socket.emit("diagnostics:ping", { t0 });
    }, 1000);

    return () => {
      alive = false;
      clearInterval(interval);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      socket.off("diagnostics:pong", onPong as any);
    };
  }, [isVisible, currentlyViewingServer?.host, sockets]);


  return (
    <DebugOverlay
      isVisible={isVisible}
      title="Microphone Debug"
      icon="🎤"
      status={{
        active: !!audioContext,
        label: audioContext?.state || "None"
      }}
    >
      {/* Device Information */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--blue-11)", fontWeight: "bold" }}>Device:</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>ID: {micID ? micID.slice(0, 8) + "..." : "None"}</div>
          <div>Name: {currentDevice?.label || "Unknown"}</div>
          <div>Available: {devicesLoading ? "Loading..." : devicesError ? "Error" : `${devices.length} devices`}</div>
          {devicesError && (
            <div style={{ color: "var(--red-11)", fontSize: "10px" }}>
              {devicesError}
            </div>
          )}
        </div>
      </div>

      {/* Audio Levels */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--blue-11)", fontWeight: "bold" }}>Audio Levels:</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>Raw: {rawVolume.toFixed(1)}%</div>
          <div>Processed: {processedVolume.toFixed(1)}%</div>
          <div>dB: {audioLevel === -Infinity ? "-∞" : audioLevel.toFixed(1)} dB</div>
        </div>
      </div>

      {/* Settings */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--blue-11)", fontWeight: "bold" }}>Settings:</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>Volume: {micVolume}%</div>
          <div>Noise Gate: {noiseGate}%</div>
          <div>Muted: {isMuted ? "🔇 Yes" : "🔊 No"}</div>
          <div>Deafened: {isDeafened ? "🔇 Yes" : "🔊 No"}</div>
        </div>
      </div>

      {/* Status */}
      <div style={{ marginBottom: "8px" }}>
        <div style={{ color: "var(--blue-11)", fontWeight: "bold" }}>Status:</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>Transmitting: {isTransmitting ? "🟢 Yes" : "🔴 No"}</div>
          <div>Stream Active: {microphoneBuffer.mediaStream?.active ? "🟢 Yes" : "🔴 No"}</div>
          <div>Context State: {audioContext?.state || "None"}</div>
        </div>
      </div>

      {/* Visual Audio Level Bar */}
      <div style={{ marginTop: "8px" }}>
        <div style={{ color: "var(--blue-11)", fontWeight: "bold", marginBottom: "4px" }}>Level:</div>
        <div style={{ 
          width: "100%", 
          height: "8px", 
          backgroundColor: "var(--gray-7)", 
          borderRadius: "4px",
          overflow: "hidden"
        }}>
          <div style={{
            width: `${Math.min(processedVolume, 100)}%`,
            height: "100%",
            backgroundColor: processedVolume > 80 ? "var(--red-9)" : 
                           processedVolume > 50 ? "var(--orange-9)" : "var(--green-9)",
            transition: "width 0.1s ease-out"
          }} />
        </div>
        <div style={{ 
          fontSize: "10px", 
          color: "var(--gray-9)", 
          marginTop: "2px",
          textAlign: "right" 
        }}>
          {processedVolume.toFixed(1)}%
        </div>
      </div>

      {/* Network / latency */}
      <div style={{ marginTop: "12px" }}>
        <div style={{ color: "var(--blue-11)", fontWeight: "bold", marginBottom: "4px" }}>Latency:</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>Socket RTT: {socketRttMs == null ? "—" : `${Math.round(socketRttMs)} ms`}</div>
          <div>WebRTC RTT: {latency.networkRttMs == null ? "—" : `${latency.networkRttMs.toFixed(1)} ms`}</div>
          <div>Jitter: {latency.jitterMs == null ? "—" : `${latency.jitterMs.toFixed(1)} ms`}</div>
          <div>Jitter buffer: {latency.jitterBufferMs == null ? "—" : `${latency.jitterBufferMs.toFixed(1)} ms`}</div>
          <div>Packets lost: {latency.packetsLost == null ? "—" : `${latency.packetsLost}`}</div>
          <div>Avail out: {latency.availableOutKbps == null ? "—" : `${Math.round(latency.availableOutKbps)} kbps`}</div>
          <div>Bitrate: {latency.bitrateKbps == null ? "—" : `${latency.bitrateKbps.toFixed(1)} kbps`}</div>
          <div>Codec: {latency.codec || "—"}</div>
        </div>
      </div>

      {/* Pipeline latency */}
      <div style={{ marginTop: "8px" }}>
        <div style={{ color: "var(--blue-11)", fontWeight: "bold", marginBottom: "4px" }}>Pipeline ({modeLabel}):</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div>Context base: {latency.contextBaseLatencyMs == null ? "—" : `${latency.contextBaseLatencyMs.toFixed(1)} ms`}</div>
          <div>Context output: {latency.contextOutputLatencyMs == null ? "—" : `${latency.contextOutputLatencyMs.toFixed(1)} ms`}</div>
          <div style={{ color: latency.rnnoiseBufferMs != null && latency.rnnoiseBufferMs > 50 ? "var(--orange-11)" : "inherit" }}>
            RNNoise buffer: {latency.rnnoiseBufferMs == null ? "off" : `${latency.rnnoiseBufferMs.toFixed(1)} ms`}
          </div>
          <div>Local pipeline: {latency.localPipelineMs == null ? "—" : `${latency.localPipelineMs.toFixed(1)} ms`}</div>
        </div>
      </div>

      {/* Estimated totals */}
      <div style={{ marginTop: "8px" }}>
        <div style={{ color: "var(--green-11)", fontWeight: "bold", marginBottom: "4px" }}>Estimated:</div>
        <div style={{ marginLeft: "8px", fontSize: "11px" }}>
          <div style={{ fontWeight: "bold" }}>
            One-way: {latency.estimatedOneWayMs == null ? "—" : `${latency.estimatedOneWayMs.toFixed(1)} ms`}
          </div>
          <div>
            Round-trip: {latency.estimatedRoundTripMs == null ? "—" : `${latency.estimatedRoundTripMs.toFixed(1)} ms`}
          </div>
        </div>
      </div>
    </DebugOverlay>
  );
}
