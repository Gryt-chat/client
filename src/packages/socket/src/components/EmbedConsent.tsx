import { Button } from "@gryt/ui";

import { PiPlayFill } from "../../../../lib/icons";
import { DismissButton } from "./EmbedRenderers";

/**
 * Nothing from another company loads until somebody asks for it (GRYT-1128).
 *
 * A link embed is somebody else's web page running inside Gryt. It was loading
 * the moment the message was drawn, which made reading a channel an event in
 * eight other companies' analytics — chosen by whoever posted the link, not by
 * the person reading it.
 *
 * The one that gave it away: a Spotify track posted in a channel loads
 * Spotify's embed player, which is a Next.js app carrying Spotify's own Sentry.
 * It reported a session on load, before anybody pressed play. It only failed to
 * arrive because the machine that noticed it blocks sentry.io at DNS.
 *
 * Cross-origin already keeps them out of Gryt — they cannot read the DOM,
 * storage or messages. What they get without this is the frame carrying their
 * own cookies, so the platform learns that a specific logged-in account of
 * theirs viewed a specific track, at a time, from an IP.
 *
 * ## Why a button rather than a sandbox
 *
 * `sandbox` without `allow-same-origin` would take the cookies away and cost
 * the thing that makes these worth having: Spotify plays a whole track only for
 * a listener it recognises, and sandboxed it drops to a thirty-second preview.
 * A button keeps the full player for anybody who wants it and costs nothing to
 * anybody who does not — and pressing it is a choice the reader made, which is
 * the part that was missing.
 */
export interface EmbedProvider {
  /** What the reader is being asked to load, in their words. */
  name: string;
  /** The host it comes from, shown so the claim is checkable. */
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
