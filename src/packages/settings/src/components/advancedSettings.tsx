import { Divider, Switch } from "@gryt/ui";
import { useState } from "react";

import { useSettings } from "@/settings";
import { newVoiceOn, setNewVoice } from "@/webRTC/src/adapters/voiceConfig";

import { LatencyPanel } from "./latencyPanel";
import { SettingsContainer, SliderSetting, ToggleSetting } from "./settingsComponents";

export function AdvancedSettings() {
  const {
    showAdvanced,
    setShowAdvanced,
    showDebugOverlay,
    setShowDebugOverlay,
    showVideoDebugOverlay,
    setShowVideoDebugOverlay,
    showPeerLatency,
    setShowPeerLatency,
    voiceBitrateKbps,
    setVoiceBitrateKbps,
  } = useSettings();
  const [newVoice, setNewVoiceState] = useState(newVoiceOn);

  return (
    <SettingsContainer>
      <h2 color="cyan">Advanced</h2>

      {/*
        The toggle stays visible; what it reveals does not. Everything below is
        diagnostics and internals — useful when something is wrong, noise the
        rest of the time, and previously sitting between settings people
        actually needed.

        Advanced settings are titled in cyan wherever they appear, so once this
        is on it is obvious which of the things now on screen arrived with it.
      */}
      <div>
        <div className="flex items-center gap-3">
          <span className="font-medium">Show advanced settings</span>
          <Switch
            checked={showAdvanced}
            onCheckedChange={setShowAdvanced}
          />
        </div>
        <span className="text-gryt-muted mt-1">
          Reveals diagnostics and internals across every section. They appear in
          a different colour so you can tell them apart.
        </span>
      </div>

      {!showAdvanced ? null : (
      <>
      <LatencyPanel />

      <Divider />

      <ToggleSetting
        title="Experimental voice connection"
        description="Your voice goes over Gryt's own connection instead of WebRTC, and on a Mac it runs on the phone's voice engine, except in the App Store version. It isn't finished yet. A server that doesn't support it uses WebRTC as before."
        checked={newVoice}
        onCheckedChange={(on) => {
          setNewVoiceState(on);
          setNewVoice(on);
        }}
        statusText={newVoice !== newVoiceOn ? "Restart Gryt to switch." : undefined}
      />

      {newVoice && (
        <SliderSetting
          title={`Voice quality: ${voiceBitrateKbps} kbps`}
          description="How much data your voice uses on the new connection. At 192 it sounds the same as your microphone. Turn it down on phone data or weak Wi-Fi; 96 is the lowest that still sounds good."
          value={voiceBitrateKbps}
          onChange={setVoiceBitrateKbps}
          min={96}
          max={192}
          step={16}
        />
      )}

      <Divider />

      <span className="font-bold text-gryt-muted">Diagnostics</span>

      <div>
        <div className="flex items-center gap-3">
          <span className="font-medium">Show Peer Latency</span>
          <Switch
            checked={showPeerLatency}
            onCheckedChange={setShowPeerLatency}
          />
        </div>
        <span className="text-gryt-muted mt-1">
          Display latency (ping) next to each user in the voice view
        </span>
      </div>

      <div>
        <div className="flex items-center gap-3">
          <span className="font-medium">Show Microphone Debug Overlay</span>
          <Switch
            checked={showDebugOverlay}
            onCheckedChange={setShowDebugOverlay}
          />
        </div>
        <span className="text-gryt-muted mt-1">
          Display a floating debug overlay with real-time microphone information
        </span>
      </div>

      <div>
        <div className="flex items-center gap-3">
          <span className="font-medium">Show Video Debug Overlay</span>
          <Switch
            checked={showVideoDebugOverlay}
            onCheckedChange={setShowVideoDebugOverlay}
          />
        </div>
        <span className="text-gryt-muted mt-1">
          Display a floating debug overlay with real-time video codec, resolution, and bitrate information
        </span>
      </div>
      </>
      )}
    </SettingsContainer>
  );
}
