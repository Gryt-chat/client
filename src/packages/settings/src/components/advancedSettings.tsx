import { Divider } from "@gryt/ui";

import { useSettings } from "@/settings";
import { setNewVoice, useNewVoice } from "@/webRTC/src/adapters/voiceConfig";

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
  const newVoice = useNewVoice();

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
      <ToggleSetting
        title="Show advanced settings"
        description="Reveals diagnostics and internals across every section. They appear in a different colour so you can tell them apart."
        checked={showAdvanced}
        onCheckedChange={setShowAdvanced}
      />

      {!showAdvanced ? null : (
      <>
      <LatencyPanel />

      <Divider />

      <ToggleSetting
        advanced
        title="Experimental voice connection"
        description="Your voice goes over Gryt's own connection instead of WebRTC, and on a Mac it runs on the phone's voice engine, except in the App Store version. It isn't finished yet. A server that doesn't support it uses WebRTC as before. Switching it during a call rejoins the call, with a short drop."
        checked={newVoice}
        onCheckedChange={setNewVoice}
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

      <ToggleSetting
        advanced
        title="Show peer latency"
        description="Show each person's latency (ping) next to them in the voice view."
        checked={showPeerLatency}
        onCheckedChange={setShowPeerLatency}
      />
      <ToggleSetting
        advanced
        title="Show microphone debug overlay"
        description="A floating overlay with live microphone information."
        checked={showDebugOverlay}
        onCheckedChange={setShowDebugOverlay}
      />
      <ToggleSetting
        advanced
        title="Show video debug overlay"
        description="A floating overlay with the live video codec, resolution and bitrate."
        checked={showVideoDebugOverlay}
        onCheckedChange={setShowVideoDebugOverlay}
      />
      </>
      )}
    </SettingsContainer>
  );
}
