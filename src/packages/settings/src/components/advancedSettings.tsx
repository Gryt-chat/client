import { Divider, Switch } from "@gryt/ui";
import { useSettings } from "@/settings";

import { LatencyPanel } from "./latencyPanel";
import { SettingsContainer } from "./settingsComponents";

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
  } = useSettings();

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

        <span className="text-gryt-muted mt-1">
          Turn off to keep server access tokens in session storage (cleared when you close the browser).
        </span>
      </div>
      </>
      )}
    </SettingsContainer>
  );
}
