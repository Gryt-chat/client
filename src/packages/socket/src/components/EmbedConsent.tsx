import { Button } from "@gryt/ui";

import { PiPlayFill } from "../../../../lib/icons";
import { DismissButton } from "./EmbedRenderers";

/* An embed is another company's page, and it loaded before anybody asked.
   A button rather than a sandbox: sandboxing costs full-track Spotify. */
export interface EmbedProvider {
  /** What the reader is being asked to load, in their words. */
  name: string;
  /** The host it loads from, shown so the claim is checkable. */
  host: string;
}

export function EmbedConsent({
  provider,
  onLoad,
  onDismiss,
}: {
  provider: EmbedProvider;
  onLoad: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="link-embed-container">
      <DismissButton onDismiss={onDismiss} />

      <div className="embed-consent">
        <PiPlayFill size={20} aria-hidden="true" className="embed-consent-icon" />

        <div className="embed-consent-text">
          <span className="embed-consent-title">{provider.name}</span>
          <span className="embed-consent-host">
            Loads from {provider.host}, which can see that you opened it.
          </span>
        </div>

        <Button size="small" tone="neutral" onClick={onLoad}>
          Load
        </Button>
      </div>
    </div>
  );
}
