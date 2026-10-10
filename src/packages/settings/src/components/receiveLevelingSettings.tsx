import { Alert } from "@gryt/ui";
import { type ReceiveLevelingState, useSpeakers } from "@gryt/voice";

import { useSettings } from "@/settings";

import { ToggleSetting } from "./settingsComponents";

export function ReceiveLevelingControl({ enabled, onChange, state }: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  state: ReceiveLevelingState;
}) {
  const status = enabled ? state.status : "disabled";
  const messages = {
    disabled: "Off. Each person's volume still applies.",
    loading: "Starting audio processing…",
    active: `Running · added processing delay: ${state.latencyMs} ms`,
    degraded: "Limited protection. Automatic boost is unavailable.",
    suspended: "Waiting for audio playback.",
  };
  return <>
    <ToggleSetting title="Receive loudness leveling"
      description="Keep remote voices at a steadier volume. Each person's volume slider still applies. Screen audio is not automatically boosted."
      checked={enabled} onCheckedChange={onChange} />
    <div role="status" data-testid="receive-leveling-status">
      {status === "degraded"
        ? <Alert severity="warning">{messages.degraded}</Alert>
        : <p className="text-gryt-muted">{messages[status]}</p>}
      {status !== "active" && state.latencyMs > 0 && <p className="text-gryt-muted text-sm">
        Added processing delay: {state.latencyMs} ms
      </p>}
      {enabled && state.reason && <p className="text-gryt-muted text-sm">Diagnostic: {state.reason}</p>}
    </div>
  </>;
}

export function ReceiveLevelingSettings() {
  const { receiveLevelingEnabled, setReceiveLevelingEnabled } = useSettings();
  const { receiveLevelingState } = useSpeakers();
  return <ReceiveLevelingControl enabled={receiveLevelingEnabled}
    onChange={setReceiveLevelingEnabled} state={receiveLevelingState} />;
}
