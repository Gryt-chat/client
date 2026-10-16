import { base64Url } from "@gryt/crypto";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { comparisonCode, identityScopeFor, markPeerCompared, ownComparisonSide, pinPeerKey } from "@/common";

import { useSockets } from "./useSockets";

/** One member's key on one server, and the code to compare when it changed. Shared by
    the member card and the key check dialog (GRYT-1789). */
export function useKeyCheck(serverHost: string | undefined, memberId: string, nickname: string) {
  const { memberKeyStates, sockets } = useSockets();
  const [ownKeys, setOwnKeys] = useState<{ thumbprint: string; dmPublicKey: string } | null>(null);
  const keyState = serverHost ? memberKeyStates[serverHost]?.[memberId] : undefined;

  /* Our own half of the comparison code, which needs what we published here. */
  useEffect(() => {
    if (!serverHost) {
      setOwnKeys(null);
      return;
    }
    let live = true;
    void ownComparisonSide(serverHost)
      .then((side) => {
        if (live) setOwnKeys(side);
      })
      .catch(() => {
        if (live) setOwnKeys(null);
      });
    return () => {
      live = false;
    };
  }, [serverHost]);

  const decision = keyState?.decision;
  const code =
    ownKeys && decision?.kind === "known"
      ? comparisonCode(ownKeys, { thumbprint: decision.pin.thumbprint, dmPublicKey: decision.pin.dmPublicKey })
      : null;

  /* Board 5c: the code for the key they have now, so a changed key can be checked and then trusted. */
  const newKeys = useMemo(
    () =>
      decision?.kind === "changed"
        ? { thumbprint: decision.verified.identityThumbprint, dmPublicKey: base64Url(decision.verified.dmPublicKey) }
        : null,
    [decision],
  );
  const newCode = ownKeys && newKeys ? comparisonCode(ownKeys, newKeys) : null;

  const trustNewKey = useCallback(() => {
    if (!serverHost || decision?.kind !== "changed" || !newKeys) return;
    const scope = identityScopeFor(serverHost);
    pinPeerKey(scope, memberId, decision.verified);
    // Compared, since that is what the button says happened.
    markPeerCompared(scope, memberId, newKeys);
    // Key decisions are made on each member list, so ask for one rather than wait.
    sockets[serverHost]?.emit("members:fetch");
    toast.success(`Trusted ${nickname}’s new key`);
  }, [serverHost, decision, newKeys, memberId, sockets, nickname]);

  return { keyState, changed: decision?.kind === "changed", code, newCode, trustNewKey };
}
