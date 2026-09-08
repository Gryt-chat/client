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
 * Claiming a guest membership on one server. On a fresh device the person saying
 * "I have used this server before" *is* the consent (GRYT-285).
 */
export function useIdentityClaim() {
  const { isSignedIn } = useAccount();
  const { reconnectServer } = useSockets();

  /**
   * Whether claiming is still on the table for this server. A previous "no" does
   * not close it; an existing "yes" does, because it has already happened.
   */
  const canClaim = useCallback(
    (host: string | null | undefined): boolean =>
      Boolean(isSignedIn && host && getClaimDecision(identityScopeFor(host)) !== "yes"),
    [isSignedIn],
  );

  /**
   * Agree to it, and make it happen. Dropping the session puts the next connect
   * back on the join path, where the link is signed (GRYT-286).
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
