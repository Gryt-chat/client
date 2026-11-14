import { base64Url, getPeerPin, markPeerCompared } from "@gryt/crypto";
import { useEffect, useState } from "react";

import { comparisonCode, identityScopeFor, localPeerPinStore, ownComparisonSide, pinPeerKey } from "@/common";

import { useSockets } from "./useSockets";

export interface PeerKeyCheck {
  /** "known": the key we have pinned; "changed": a new one waiting to be trusted; null: nothing to compare yet. */
  kind: "known" | "changed" | null;
  code: string | null;
  comparedAt: number | null;
  /** They read back the same code. A changed key is trusted by this too. Returns false when the key moved meanwhile. */
  confirm(): boolean;
}

/** The comparison code for one person on one server, and what "they match" does with it. */
export function usePeerKeyCheck(serverHost: string | undefined, serverUserId: string | undefined): PeerKeyCheck {
  const { memberKeyStates, sockets } = useSockets();
  const [ownKeys, setOwnKeys] = useState<{ thumbprint: string; dmPublicKey: string } | null>(null);
  const decision = serverHost && serverUserId ? memberKeyStates[serverHost]?.[serverUserId]?.decision : undefined;

  useEffect(() => {
    if (!serverHost) return setOwnKeys(null);
    let live = true;
    void ownComparisonSide(serverHost)
      .then((side) => live && setOwnKeys(side))
      .catch(() => live && setOwnKeys(null));
    return () => {
      live = false;
    };
  }, [serverHost]);

  let theirs: { thumbprint: string; dmPublicKey: string } | null = null;
  if (decision?.kind === "known") theirs = { thumbprint: decision.pin.thumbprint, dmPublicKey: decision.pin.dmPublicKey };
  if (decision?.kind === "changed") theirs = { thumbprint: decision.verified.identityThumbprint, dmPublicKey: base64Url(decision.verified.dmPublicKey) };
  const kind = decision?.kind === "known" || decision?.kind === "changed" ? decision.kind : null;

  return {
    kind,
    code: ownKeys && theirs ? comparisonCode(ownKeys, theirs) : null,
    comparedAt: decision?.kind === "known" ? decision.pin.comparedAt ?? null : null,
    confirm() {
      if (!serverHost || !serverUserId || !theirs || !decision) return false;
      const scope = identityScopeFor(serverHost);
      if (decision.kind === "changed") pinPeerKey(scope, serverUserId, decision.verified);
      // The pin's person key has to match too, so it's read back rather than left out.
      const personPublicKey = getPeerPin(localPeerPinStore, scope, serverUserId)?.personPublicKey;
      const ok = markPeerCompared(localPeerPinStore, scope, serverUserId, { ...theirs, personPublicKey });
      // Key decisions are made on each member list, so ask for one rather than wait.
      sockets[serverHost]?.emit("members:fetch");
      return decision.kind === "changed" || ok;
    },
  };
}
