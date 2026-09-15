import { useCallback } from "react";

import {
  getClaimDecision,
  identityScopeFor,
  removeServerAccessToken,
  removeServerRefreshToken,
  setClaimDecision,
  useAccount,
} from "@/common";
import { expectClaimOutcome } from "@/lib/identityClaimOutcome";
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

  /** Without a stored session the next connect takes the join path, which answers
      as the account and signs the link only after a yes. */
  const rejoinAsAccount = useCallback(
    (host: string) => {
      removeServerAccessToken(host);
      removeServerRefreshToken(host);
      reconnectServer(host);
    },
    [reconnectServer],
  );

  const claim = useCallback(
    (host: string) => {
      setClaimDecision(identityScopeFor(host), "yes");
      expectClaimOutcome(host);
      rejoinAsAccount(host);
    },
    [rejoinAsAccount],
  );

  /** The guest stays as it is on the server and this device stops using it there.
      Its keys are kept, so the server menu can still move it later. */
  const decline = useCallback(
    (host: string) => {
      setClaimDecision(identityScopeFor(host), "no");
      rejoinAsAccount(host);
    },
    [rejoinAsAccount],
  );

  return { canClaim, claim, decline };
}
