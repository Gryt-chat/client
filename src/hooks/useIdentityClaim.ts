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
 * Claiming a guest membership on one server, from either direction (GRYT-285).
 *
 * Two things reach this. `IdentityClaimPrompt` asks on its own when the local
 * guest history says this device has been here before. The server context menu
 * offers it by hand for the case the history cannot cover: a seed restored onto
 * a device that has never been to this server, where nothing local knows there
 * is anything to claim.
 *
 * That second route is not a convenience. The history is deliberately the only
 * way to know without asking the server, and asking the server means proving
 * the link, which is the disclosure itself. On a fresh device there is nothing
 * to go on — so the person saying "I have used this server before" *is* the
 * consent, and the only source of it.
 */
export function useIdentityClaim() {
  const { isSignedIn } = useAccount();
  const { reconnectServer } = useSockets();

  /**
   * Whether claiming is still on the table for this server.
   *
   * A previous "no" does not close it. Somebody who declined on a shared
   * machine and later thinks better of it should not have to sign out to change
   * their mind, and the decision is only consulted when a challenge is
   * answered, so revisiting it costs nothing. An existing "yes" is the one that
   * closes it: it has already happened.
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
