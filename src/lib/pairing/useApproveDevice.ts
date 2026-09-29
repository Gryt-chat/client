import {
  type ApproverPairing,
  type ApproverState,
  createApproverPairing,
  createPairingRelay,
  type HistoryProgress,
  type PairingFetch,
} from "@gryt/core";
import { useCallback, useRef, useState } from "react";

import {
  freshAccessToken,
  getRememberedScheme,
  identityScopeFor,
  initKeycloak,
  listPeerPins,
  openLocalArchive,
  readIdentityForLinking,
  singletonHook,
  useAccount,
} from "@/common";
import { useServerSettings } from "@/settings";
import { seenOnMlsFor } from "@/socket/src/mls/seenOnMls";
import { holdLinkedDeviceNotices, ownDeviceAdder, ownMlsDevices, setMlsArchiveListener } from "@/socket/src/mls/serverMls";

import { getGrytConfig } from "../../config";
import { getElectronAPI, isElectron } from "../electron";
import { describeThisDevice } from "./device";
import { serversAtDeviceCap } from "./deviceCap";
import { accountFromToken, buildEnvelope } from "./envelope";
import { historyArchive } from "./historyArchive";
import { toHistoryRecord } from "./historyRecords";

/* The approving side of linking (GRYT-1484): this device claims the new one's code, shows
   the emoji, and on Approve hands over its identity, signs the new device in and adds it. */

const pairingFetch: PairingFetch = (url, init) => fetch(url, init);

export interface ApproveDevice {
  isOpen: boolean;
  /** Null while the code is being typed. */
  state: ApproverState | null;
  /** Set when the envelope couldn't be put together, which is this device's problem, not the other's. */
  failure: string | null;
  /** The history going across, once approved. Null with no archive here. */
  history: HistoryProgress | null;
  /** Servers where the new device would be a sixth, read while confirming. */
  fullServers: { host: string; name: string }[];
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
  history: null,
  fullServers: [],
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
  const [history, setHistory] = useState<HistoryProgress | null>(null);
  const [fullServers, setFullServers] = useState<{ host: string; name: string }[]>([]);
  const pairing = useRef<ApproverPairing | null>(null);
  const claiming = useRef<object | null>(null);
  const live = useRef({ isSignedIn, servers });
  live.current = { isSignedIn, servers };

  const reset = useCallback(() => {
    pairing.current?.cancel().catch(() => undefined);
    pairing.current = null;
    claiming.current = null;
    setState(null);
    setFailure(null);
    setHistory(null);
    setFullServers([]);
  }, []);

  const open = useCallback(() => {
    if (!inFlight(pairing.current?.state.phase)) reset();
    setIsOpen(true);
  }, [reset]);

  const claim = useCallback((code: string) => {
    reset();
    const attempt = {};
    claiming.current = attempt;
    setState({ phase: "claiming" });
    void (async () => {
      const opened = await openLocalArchive().catch((e: unknown) => {
        console.warn("[Pairing] No archive, so no history goes across:", e);
        return null;
      });
      if (claiming.current !== attempt) return;
      const relayOrigin = getGrytConfig().GRYT_IDENTITY_URL.replace(/\/+$/, "");
      const next = createApproverPairing({
        relay: createPairingRelay(relayOrigin, pairingFetch),
        relayOrigin,
        fetch: pairingFetch,
        devices: ownDeviceAdder,
        history: opened ? historyArchive(opened.messages) : undefined,
      });
      pairing.current = next;
      let release: (() => void) | null = null;
      next.subscribe((s) => {
        if (s.phase === "confirming") void checkDeviceCap(next);
        if (inFlight(s.phase) && !release) {
          release = holdLinkedDeviceNotices();
          setMlsArchiveListener((host, m) => next.noteMessage({ host, ...m, record: toHistoryRecord(m.record) }));
        }
        if ((s.phase === "done" || s.phase === "ended") && release) {
          setMlsArchiveListener(null);
          release();
        }
        if (pairing.current !== next) return;
        setState(s);
        if (s.phase === "browser") openInBrowser(s.url);
      });
      next.subscribeHistory((progress) => {
        if (pairing.current === next) setHistory(progress);
      });
      next.claim({ code });
    })();
  }, [reset]);

  const checkDeviceCap = async (of: ApproverPairing) => {
    const list = Object.values(live.current.servers);
    const counts = await Promise.all(
      list.map(async ({ host, name }) => {
        const answer = await ownMlsDevices(host).catch(() => null);
        return { host, name: name || host, deviceCount: answer?.kind === "devices" ? answer.devices.length : null };
      }),
    );
    if (pairing.current === of) setFullServers(serversAtDeviceCap(counts).map(({ host, name }) => ({ host, name })));
  };

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

  return { isOpen, state, failure, history, fullServers, open, claim, approve, deny, mismatch, close };
});

const inFlight = (phase: ApproverState["phase"] | undefined) =>
  phase === "signing_in" || phase === "browser" || phase === "waiting_ready" || phase === "adding" || phase === "sending";

function openInBrowser(url: string) {
  const api = getElectronAPI();
  if (api) api.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
