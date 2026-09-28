import { type ApproverPairing, type ApproverState, createApproverPairing, createPairingRelay, type PairingFetch } from "@gryt/core";
import { useCallback, useRef, useState } from "react";

import {
  freshAccessToken,
  getRememberedScheme,
  identityScopeFor,
  initKeycloak,
  listPeerPins,
  readIdentityForLinking,
  singletonHook,
  useAccount,
} from "@/common";
import { useServerSettings } from "@/settings";
import { seenOnMlsFor } from "@/socket/src/mls/seenOnMls";
import { ownDeviceAdder } from "@/socket/src/mls/serverMls";

import { getGrytConfig } from "../../config";
import { getElectronAPI, isElectron } from "../electron";
import { describeThisDevice } from "./device";
import { accountFromToken, buildEnvelope } from "./envelope";

/* The approving side of linking (GRYT-1484): this device claims the new one's code, shows
   the emoji, and on Approve hands over its identity, signs the new device in and adds it. */

const pairingFetch: PairingFetch = (url, init) => fetch(url, init);

export interface ApproveDevice {
  isOpen: boolean;
  /** Null while the code is being typed. */
  state: ApproverState | null;
  /** Set when the envelope couldn't be put together, which is this device's problem, not the other's. */
  failure: string | null;
  open(): void;
  claim(code: string): void;
  approve(): void;
  deny(): void;
  mismatch(): void;
  close(): void;
}

const init: ApproveDevice = {
  isOpen: false,
  state: null,
  failure: null,
  open: () => {},
  claim: () => {},
  approve: () => {},
  deny: () => {},
  mismatch: () => {},
  close: () => {},
};

function thisDeviceName(): string {
  const d = describeThisDevice(navigator.userAgent, isElectron());
  return isElectron() ? d.name : `${d.name} on ${d.platform}`;
}

export const useApproveDevice = singletonHook<ApproveDevice>(init, () => {
  const { isSignedIn } = useAccount();
  const { servers } = useServerSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<ApproverState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pairing = useRef<ApproverPairing | null>(null);
  const live = useRef({ isSignedIn, servers });
  live.current = { isSignedIn, servers };

  const reset = useCallback(() => {
    pairing.current?.cancel().catch(() => undefined);
    pairing.current = null;
    setState(null);
    setFailure(null);
  }, []);

  const open = useCallback(() => {
    if (!inFlight(pairing.current?.state.phase)) reset();
    setIsOpen(true);
  }, [reset]);

  const claim = useCallback((code: string) => {
    reset();
    const relayOrigin = getGrytConfig().GRYT_IDENTITY_URL.replace(/\/+$/, "");
    const next = createApproverPairing({
      relay: createPairingRelay(relayOrigin, pairingFetch),
      relayOrigin,
      fetch: pairingFetch,
      devices: ownDeviceAdder,
    });
    pairing.current = next;
    next.subscribe((s) => {
      if (pairing.current !== next) return;
      setState(s);
      if (s.phase === "browser") openInBrowser(s.url);
    });
    next.claim({ code });
    setState(next.state);
  }, [reset]);

  const approve = useCallback(() => {
    const current = pairing.current;
    if (!current || current.state.phase !== "confirming") return;
    void (async () => {
      try {
        const cfg = getGrytConfig();
        const { seed, keys } = await readIdentityForLinking();
        let account;
        if (live.current.isSignedIn) {
          const { keycloak } = await initKeycloak();
          account = accountFromToken(keycloak.tokenParsed, { clientId: cfg.GRYT_OIDC_CLIENT_ID, identityUrl: cfg.GRYT_IDENTITY_URL });
          if (!account) throw new Error("Couldn't read which account this device is signed in to.");
        }
        const envelope = buildEnvelope({
          seed,
          keys,
          account: account ?? undefined,
          servers: Object.values(live.current.servers).map(({ host, name }) => ({
            host,
            name,
            scope: identityScopeFor(host),
            scheme: getRememberedScheme(host),
          })),
          pins: listPeerPins(),
          seenOnMls: (scope, memberId) => seenOnMlsFor(scope).has(memberId),
          from: thisDeviceName(),
        });
        current.approve(envelope, account ? freshAccessToken : undefined);
      } catch (e) {
        console.warn("[Pairing] Couldn't approve:", e);
        setFailure(e instanceof Error ? e.message : "Couldn't put together what to send.");
        await current.cancel();
      }
    })();
  }, []);

  const deny = useCallback(() => void pairing.current?.deny(), []);
  const mismatch = useCallback(() => void pairing.current?.mismatch(), []);

  const close = useCallback(() => {
    // Once approved, closing only hides it: the new device is still being signed in and added.
    if (!inFlight(pairing.current?.state.phase)) reset();
    setIsOpen(false);
  }, [reset]);

  return { isOpen, state, failure, open, claim, approve, deny, mismatch, close };
});

const inFlight = (phase: ApproverState["phase"] | undefined) =>
  phase === "signing_in" || phase === "browser" || phase === "waiting_ready" || phase === "adding";

function openInBrowser(url: string) {
  const api = getElectronAPI();
  if (api) api.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
