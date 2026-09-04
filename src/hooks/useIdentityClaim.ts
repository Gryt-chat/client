import { useCallback } from "react";

import {
  getClaimDecision,
  identityScopeFor,
  removeServerAccessToken,
  removeServerRefreshToken,
  setClaimDecision,
  useAccount,
} from "@/common";
import { useSockets } from "@/socket";

/**
 * Claiming a guest membership on one server (GRYT-285). `IdentityClaimPrompt`
 * asks when the local guest history says this device has been here; the context
 * menu offers it by hand for a seed restored onto a device that has not.
 *
 * **The second route is not a convenience.** Asking the server would mean
 * proving the link, which is the disclosure itself — so on a fresh device the
 * person saying "I have used this server before" *is* the consent.
 */
export function useIdentityClaim() {
  const { isSignedIn } = useAccount();
  const { reconnectServer } = useSockets();

  /**
   * Whether claiming is still on the table for this server.
   *
   * A previous "no" does not close it — the decision is only consulted when a
   * challenge is answered, so revisiting it costs nothing, and somebody who
   * declined on a shared machine should not have to sign out to change their
   * mind. An existing "yes" does close it: it has already happened.
   */
  const canClaim = useCallback(
    (host: string | null | undefined): boolean =>
      Boolean(isSignedIn && host && getClaimDecision(identityScopeFor(host)) !== "yes"),
    [isSignedIn],
  );

  /**
   * Agree to it, and make it happen.
   *
   * The decision is read when a challenge is answered, and a connected client
   * is long past that. Dropping the session is what puts the next connect back
   * on the join path, where the challenge is asked again and the link is signed
   * (GRYT-286).
   */
  const claim = useCallback(
    (host: string) => {
      setClaimDecision(identityScopeFor(host), "yes");
      removeServerAccessToken(host);
      removeServerRefreshToken(host);
      reconnectServer(host);
    },
    [reconnectServer],
  );

  /** Decline, and stop being asked about this server. */
  const decline = useCallback((host: string) => {
    setClaimDecision(identityScopeFor(host), "no");
  }, []);

  return { canClaim, claim, decline };
}
