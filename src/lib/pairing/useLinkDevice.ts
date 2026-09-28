import {
  createNewDevicePairing,
  createPairingRelay,
  type NewDevicePairing,
  type NewDeviceState,
  type PairedServerDevice,
  type PairingFetch,
} from "@gryt/core";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  expectServerLineage,
  installPairedIdentity,
  listGuestScopes,
  localPeerPinStore,
  rememberMessageKeyHere,
  rememberScheme,
  singletonHook,
  useAccount,
} from "@/common";
import { useServerSettings } from "@/settings";
import { updateStoredValueFor } from "@/settings/src/hooks/userStorage";
import type { Server, Servers } from "@/settings/src/types/server";
import { seenOnMlsFor } from "@/socket/src/mls/seenOnMls";
import { forgetOwnMlsDevices, whenOwnMlsDevice } from "@/socket/src/mls/serverMls";

import { getGrytConfig, setCustomAuthIssuer, setCustomIdentityUrl } from "../../config";
import { isElectron } from "../electron";
import { describeThisDevice } from "./device";
import { createLinkStorage } from "./install";
import { createPairingOidc } from "./oidc";

/* The new-device side of linking (GRYT-1484). A singleton, so the pairing outlives the
   screen that opened it: signing in swaps half the app out from under it. */

const DEFAULT_RELAY = "https://id.gryt.chat";
/** How long each server gets to publish this device's KeyPackages before "ready" goes without it. */
const JOIN_WAIT_MS = 45_000;

const pairingFetch: PairingFetch = (url, init) => fetch(url, init);

export interface LinkDevice {
  isOpen: boolean;
  /** Null until it starts. It waits for a yes when this device already has an identity in use. */
  state: NewDeviceState | null;
  /** Servers or guest identities this device already has, which linking replaces. */
  replaces: number;
  open(): void;
  start(): void;
  close(): void;
  mismatch(): void;
}

const init: LinkDevice = {
  isOpen: false,
  state: null,
  replaces: 0,
  open: () => {},
  start: () => {},
  close: () => {},
  mismatch: () => {},
};

function toServerEntries(existing: Servers | undefined, incoming: { host: string; name: string }[]): Servers {
  const next: Servers = { ...(existing ?? {}) };
  for (const { host, name } of incoming) next[host] ??= { host, name } satisfies Server;
  return next;
}

export const useLinkDevice = singletonHook<LinkDevice>(init, () => {
  const { adoptLinkedSession } = useAccount();
  const { servers, setServers } = useServerSettings();
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<NewDeviceState | null>(null);
  const [replaces, setReplaces] = useState(0);
  const pairing = useRef<NewDevicePairing | null>(null);
  const live = useRef({ servers, setServers, adoptLinkedSession });
  live.current = { servers, setServers, adoptLinkedSession };

  const start = useCallback(() => {
    pairing.current?.cancel().catch(() => undefined);
    const cfg = getGrytConfig();
    const relayOrigin = cfg.GRYT_IDENTITY_URL.replace(/\/+$/, "");

    const storage = createLinkStorage({
      installIdentity: installPairedIdentity,
      expectLineage: expectServerLineage,
      pinStore: localPeerPinStore,
      markSeenOnMls: (scope, memberId) => seenOnMlsFor(scope).add(memberId),
      async writeServers(list, account) {
        for (const s of list) if (s.scheme) rememberScheme(s.host, s.scheme);
        if (account) {
          await updateStoredValueFor<Servers>(account.sub, "servers", (current) => toServerEntries(current, list));
        } else {
          live.current.setServers(toServerEntries(live.current.servers, list));
        }
      },
      currentIssuer: () => getGrytConfig().GRYT_OIDC_ISSUER,
      useAuthServer(issuer, identityUrl) {
        setCustomAuthIssuer(issuer);
        setCustomIdentityUrl(identityUrl);
      },
      adoptSession: (tokens) => live.current.adoptLinkedSession(tokens),
      rememberMessageKey: rememberMessageKeyHere,
      forgetMlsDevices: forgetOwnMlsDevices,
    });

    const next = createNewDevicePairing({
      relay: createPairingRelay(relayOrigin, pairingFetch),
      device: describeThisDevice(navigator.userAgent, isElectron()),
      storage,
      oidc: createPairingOidc(pairingFetch),
      relayOrigin: relayOrigin === DEFAULT_RELAY ? undefined : relayOrigin,
    });
    pairing.current = next;
    next.subscribe((s) => {
      if (pairing.current === next) setState(s);
    });
    setState(next.state);
    next.start();
  }, []);

  // Once everything is written, wait for each server to take this device's KeyPackages.
  useEffect(() => {
    const current = pairing.current;
    if (state?.phase !== "joining" || !current) return;
    let cancelled = false;
    void (async () => {
      const found = await Promise.all(
        state.servers.map(async ({ host }) => ({ host, deviceId: await whenOwnMlsDevice(host, JOIN_WAIT_MS) })),
      );
      if (cancelled) return;
      const devices = found.filter((d): d is PairedServerDevice => !!d.deviceId);
      await current.ready(devices).catch((e: unknown) => console.warn("[Pairing] Couldn't say ready:", e));
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  const open = useCallback(() => {
    const phase = pairing.current?.state.phase;
    if (phase === "joining" || phase === "linked") return setIsOpen(true);
    const count = Math.max(Object.keys(live.current.servers).length, listGuestScopes().length);
    setReplaces(count);
    setIsOpen(true);
    setState(null);
    if (count === 0) start();
  }, [start]);

  const close = useCallback(() => {
    const phase = pairing.current?.state.phase;
    // Closing once it's written leaves the rest running: the other device is still adding this one.
    if (phase !== "joining" && phase !== "linked" && phase !== "done") {
      pairing.current?.cancel().catch(() => undefined);
      pairing.current = null;
      setState(null);
    }
    setIsOpen(false);
  }, []);

  const mismatch = useCallback(() => {
    pairing.current?.mismatch().catch(() => undefined);
  }, []);

  return { isOpen, state, replaces, open, start, close, mismatch };
});
