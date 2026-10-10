import "../src/style.css";

import type { ReceiveLevelingState } from "@gryt/voice";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { ReceiveLevelingControl } from "../src/packages/settings/src/components/receiveLevelingSettings";
import { loadAudioFromCache, useAudioSettings } from "../src/packages/settings/src/hooks/useAudioSettings";
import { loadForUser } from "../src/packages/settings/src/hooks/userStorage";

export function Harness() {
  const prefs = useAudioSettings();
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<ReceiveLevelingState>({ status: "loading", latencyMs: 0 });
  useEffect(() => {
    void loadForUser("LEVELING_TEST_USER").then(() => {
      prefs.applyAudioData(loadAudioFromCache());
      setReady(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="gryt-app p-4">
    <output data-testid="ready">{String(ready)}</output>
    <ReceiveLevelingControl enabled={prefs.receiveLevelingEnabled} onChange={prefs.setReceiveLevelingEnabled} state={state} />
    <button onClick={() => setState({ status: "active", latencyMs: 6 })}>Active</button>
    <button onClick={() => setState({ status: "degraded", reason: "processorerror", latencyMs: 3 })}>Degraded</button>
    <button onClick={() => setState({ status: "suspended", latencyMs: 6 })}>Suspended</button>
    <output data-testid="enabled">{String(prefs.receiveLevelingEnabled)}</output>
    <output data-testid="manual-volume">{prefs.outputVolume}</output>
  </div>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
