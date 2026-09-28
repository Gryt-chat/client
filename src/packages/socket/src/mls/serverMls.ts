import type { DmSealingMode, MlsDmContent, MlsOwnDevice, MlsServerCapability } from "@gryt/core";
import { useSyncExternalStore } from "react";
import type { Socket } from "socket.io-client";

import {
  claimMlsWorker,
  getLocalArchiveSnapshot,
  getOwnServerUserId,
  getServerAccessToken,
  getValidIdentityToken,
  identityScopeFor,
  type LocalArchive,
  localPeerPinStore,
  type MlsWorkerClaim,
  newMlsDevice,
  openLocalArchive,
  ownPersonPublicKey,
  personKeyBindingFor,
  subscribeToLocalArchive,
} from "@/common";

import { isElectron } from "../../../../lib/electron";
import { readMlsCapability, readMlsReports } from "./capability";
import { createModeOnlySource } from "./modeOnly";
import { publishPersonKey } from "./publishPersonKey";
import { authTimeOf, clearRemovedHere, markRemovedHere, removedHereAt, stillRemoved } from "./removedHere";
import { seenOnMlsFor } from "./seenOnMls";
import { type ConversationProblems, createMlsSession, type MlsSession, type SessionSocket } from "./session";

/**
 * MLS for every connected server. Only the tab holding the Web Lock runs a driver; the
 * others ask it over a BroadcastChannel and read the archive (design, section 5).
 */

/** What a DM view needs, whether the driver is in this tab or another one. */
export type MlsSource = Pick<MlsSession, "storeScope" | "modeFor" | "send" | "problems" | "waiting" | "onChange">;

/** How long to wait for the member list's pins before starting anyway. */
const MEMBERS_WAIT_MS = 5000;
const RELAY_TIMEOUT_MS = 20_000;
/** A send waits up to five minutes for the server in the other tab, so this outlasts it. */
const RELAY_SEND_TIMEOUT_MS = 6 * 60_000;
const RELAY_CHANNEL = "gryt-mls-relay";
const NO_PROBLEMS: ConversationProblems = { undecryptable: 0, lost: null };

interface HostState {
  socket: Socket;
  /** Undefined until `server:info` says, null when the server has no MLS. */
  capability: MlsServerCapability | null | undefined;
  ready: boolean;
  pinned: { promise: Promise<void>; resolve: () => void };
  session: MlsSession | null;
  /** What this tab answers with: the session, or the mode-only source until it's there. */
  local: MlsSource | null;
  sessionKey: string | null;
  /** The previous session's work. The next one waits, so two drivers never share a store. */
  retiring: Promise<void>;
  /** The server removed this device, and nobody has signed in since (GRYT-1555). */
  removed: boolean;
}

const hosts = new Map<string, HostState>();
let claim: MlsWorkerClaim | null = null;

let sources: ReadonlyMap<string, MlsSource> = new Map();
const sourceListeners = new Set<() => void>();
const setSource = (host: string, source: MlsSource | null) => {
  const next = new Map(sources);
  if (source) next.set(host, source);
  else next.delete(host);
  sources = next;
  for (const listener of sourceListeners) listener();
};

let reportHosts: ReadonlySet<string> = new Set();
const reportListeners = new Set<() => void>();
const setReportsTaken = (host: string, taken: boolean) => {
  if (reportHosts.has(host) === taken) return;
  const next = new Set(reportHosts);
  if (taken) next.add(host);
  else next.delete(host);
  reportHosts = next;
  for (const listener of reportListeners) listener();
};

/** Whether this server takes a report of an MLS message. Until it does, Report isn't offered. */
export function useMlsReportsTaken(host: string | null | undefined): boolean {
  const set = useSyncExternalStore(
    (listener) => {
      reportListeners.add(listener);
      return () => reportListeners.delete(listener);
    },
    () => reportHosts,
  );
  return !!host && set.has(host);
}

/** Null until this tab knows how to reach MLS for that server. */
export function useMlsSource(host: string | null | undefined): MlsSource | null {
  const map = useSyncExternalStore(
    (listener) => {
      sourceListeners.add(listener);
      return () => sourceListeners.delete(listener);
    },
    () => sources,
  );
  return host ? (map.get(host) ?? null) : null;
}

type Delivered = { host: string; conversationId: string; senderId: string; content: MlsDmContent };
const deliveredListeners = new Set<(message: Delivered) => void>();

/** Live MLS messages from other people, once archived. Fires in the lock-holding tab only. */
export function onMlsDelivered(listener: (message: Delivered) => void): () => void {
  deliveredListeners.add(listener);
  return () => deliveredListeners.delete(listener);
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Once per socket, from `registerServerSocketEvents`. */
export function attachServerMls(socket: Socket, host: string): void {
  const previous = hosts.get(host);
  if (previous?.socket === socket) return;
  const state: HostState = {
    socket,
    capability: undefined,
    ready: false,
    pinned: deferred(),
    session: null,
    local: null,
    sessionKey: null,
    retiring: previous ? retire(previous) : Promise.resolve(),
    removed: false,
  };
  hosts.set(host, state);

  socket.on("server:info", (info: { mls?: unknown }) => {
    setReportsTaken(host, readMlsReports(info?.mls));
    const next = readMlsCapability(info?.mls);
    if (state.capability !== undefined && JSON.stringify(state.capability) === JSON.stringify(next)) return;
    state.capability = next;
    void refresh(host);
  });
  socket.on("disconnect", () => {
    state.ready = false;
    state.pinned = deferred();
  });

  claim ??= claimMlsWorker({
    onAcquire: () => {
      listenForRelay();
      for (const h of hosts.keys()) void refresh(h);
    },
  });
  if (!claim.held) setSource(host, relaySource(host));
}

/** The session is back: `server:details` answered without an error. */
export function serverMlsReady(host: string): void {
  const state = hosts.get(host);
  if (!state || state.ready) return;
  state.ready = true;
  void refresh(host);
}

/** The member list's person keys are pinned. A Welcome from somebody unpinned is thrown away. */
export function serverMlsPinned(host: string): void {
  hosts.get(host)?.pinned.resolve();
}

function retire(state: HostState): Promise<void> {
  const session = state.session;
  state.session = null;
  return session ? session.dispose() : Promise.resolve();
}

async function refresh(host: string): Promise<void> {
  const state = hosts.get(host);
  const serverUserId = getOwnServerUserId(host);
  if (!state || !claim?.held || !state.ready || !serverUserId) return;
  const capability = state.capability ?? null;
  const key = JSON.stringify([serverUserId, capability]);

  try {
    if (state.sessionKey !== key) {
      state.sessionKey = key;
      state.removed = false;
      const scope = identityScopeFor(host);
      // Version 1 needs no archive, so DMs that don't need MLS go on while it opens or if it won't.
      state.local = createModeOnlySource({
        socket: state.socket,
        storeScope: scope,
        dmScope: scope,
        serverUserId,
        capability,
        getAccessToken: async () => getServerAccessToken(host),
        seen: seenOnMlsFor(scope),
      });
      setSource(host, state.local);
      state.retiring = state.retiring.then(() => retire(state));
      await state.retiring;
      if (!capability) return;
      const [archive, ownPersonKey] = await Promise.all([openLocalArchive(), ownPersonPublicKey(host)]);
      if (hosts.get(host) !== state || state.sessionKey !== key) return;
      state.removed = await stillRemovedHere(scope, archive);
      if (state.removed) {
        state.local = removedSource(state.local);
        setSource(host, state.local);
        return;
      }
      state.session = createMlsSession({
        socket: state.socket as unknown as SessionSocket,
        storeScope: scope,
        dmScope: scope,
        serverUserId,
        capability,
        getAccessToken: async () => getServerAccessToken(host),
        messages: archive.messages,
        store: archive.mlsState(scope, claim),
        pinStore: localPeerPinStore,
        seen: seenOnMlsFor(scope),
        ownPersonKey,
        newDevice: () => newMlsDevice(host, isElectron() ? "Desktop" : "Web browser"),
        onDelivered: (m) => {
          for (const listener of deliveredListeners) listener({ host, ...m });
        },
        onDeviceRemoved: () => {
          markRemovedHere(scope);
          state.sessionKey = null;
          void refresh(host);
        },
      });
      state.session.onChange((conversationId) => relayChannel?.postMessage({ changed: host, conversationId }));
      state.local = state.session;
      setSource(host, state.session);
    }

    const session = state.session;
    const accessToken = getServerAccessToken(host);
    if (!session?.capability || !accessToken) return;
    state.socket.emit("dm:list", { accessToken });
    await publishPersonKey(state.socket, accessToken, await personKeyBindingFor(host));
    // Never holds up the start: a device left behind is tried again on the next connect.
    await retireOldDevices(session).catch((e: unknown) => console.warn("[MLS] Retiring old devices failed:", e));
    await Promise.race([state.pinned.promise, new Promise((r) => setTimeout(r, MEMBERS_WAIT_MS))]);
    if (state.session === session) await session.start();
  } catch (e) {
    // Tried again on the next connect rather than left without a session for good.
    if (!state.session) state.sessionKey = null;
    console.warn("[MLS] Couldn't start for", host, e);
  }
}

/** Wiped again on every start while it holds, so a crash between marking and wiping leaves nothing. */
async function stillRemovedHere(scope: string, archive: LocalArchive): Promise<boolean> {
  const at = removedHereAt(scope);
  if (at === null) return false;
  const token = await getValidIdentityToken(0).catch(() => undefined);
  if (!stillRemoved(at, authTimeOf(token))) {
    clearRemovedHere(scope);
    return false;
  }
  await archive.wipeServer(scope);
  return true;
}

/** DMs on a server that removed this device: version 1 to a peer without MLS, and nothing else. */
function removedSource(base: MlsSource): MlsSource {
  const refused: DmSealingMode = { kind: "refused", reason: "no_own_device" };
  return {
    storeScope: base.storeScope,
    async modeFor(conversationId, peer) {
      const mode = await base.modeFor(conversationId, peer).catch(() => refused);
      return mode.kind === "sealed-v1" ? mode : refused;
    },
    send: () =>
      Promise.reject(Object.assign(new Error("This device was removed from encrypted DMs on this server."), { code: "device_removed" })),
    problems: () => ({ undecryptable: 0, lost: "device_removed" }),
    onChange: base.onChange,
  };
}

/** Devices whose state a clear wiped. Removed so peers stop encrypting to a device that can't read. */
async function retireOldDevices(session: MlsSession): Promise<void> {
  const scope = session.storeScope;
  const archive = await openLocalArchive();
  const retired = await archive.retiredMlsDevices(scope);
  if (!retired.length) return;
  const current = (await archive.mlsState(scope, claim ?? undefined).loadDevice())?.deviceId;
  for (const deviceId of retired) {
    if (deviceId !== current) {
      try {
        await session.removeOwnDevice(deviceId);
      } catch (e) {
        const code = (e as { refusal?: { error?: string } })?.refusal?.error;
        // Already gone from the server counts as done. Anything else is tried on the next connect.
        if (code !== "unknown_device" && code !== "invalid_device" && code !== "device_removed") {
          console.warn("[MLS] Couldn't remove an old device:", deviceId, e);
          continue;
        }
      }
    }
    await archive.forgetRetiredMlsDevice(scope, deviceId);
  }
}

// After a clear, or a retry that got the keychain to open it, every session starts again.
let archiveSeen = getLocalArchiveSnapshot();
subscribeToLocalArchive(() => {
  const next = getLocalArchiveSnapshot();
  const cleared = next.epoch !== archiveSeen.epoch;
  const recovered = archiveSeen.status.kind === "failed" && next.status.kind === "open";
  archiveSeen = next;
  if (!cleared && !recovered) return;
  for (const [host, state] of hosts) {
    if (cleared) state.sessionKey = null;
    void refresh(host);
  }
});

// ── Your devices, for Settings ─────────────────────────────────────────

/** One server's answer for the device list. */
export type OwnDevicesAnswer =
  | { kind: "devices"; devices: MlsOwnDevice[] }
  | { kind: "no_mls" }
  | { kind: "not_connected" }
  | { kind: "removed" };

async function ownDevicesHere(host: string): Promise<OwnDevicesAnswer> {
  const state = hosts.get(host);
  if (state?.capability === null) return { kind: "no_mls" };
  if (state?.removed) return { kind: "removed" };
  if (!state?.session) return { kind: "not_connected" };
  return { kind: "devices", devices: await state.session.ownDevices() };
}

async function removeHere(host: string, deviceId: string): Promise<void> {
  const session = hosts.get(host)?.session;
  if (!session) throw new Error("This server isn't connected.");
  await session.removeOwnDevice(deviceId);
}

const askOtherTab = () => !!claim && !claim.held && !!relayChannel;

/** Your devices on one server, from whichever tab runs its driver. */
export async function ownMlsDevices(host: string): Promise<OwnDevicesAnswer> {
  if (!askOtherTab()) return ownDevicesHere(host);
  return (await askRelay({ host, op: "devices" })).devices ?? { kind: "not_connected" };
}

/** Takes one of your devices off that server. Your other devices drop it from each DM. */
export async function removeOwnMlsDevice(host: string, deviceId: string): Promise<void> {
  if (!askOtherTab()) return removeHere(host, deviceId);
  await askRelay({ host, op: "remove", deviceId });
}

// ── Other tabs ask the one holding the lock ─────────────────────────────

type RelayRequest = {
  id: string;
  host: string;
  op: "mode" | "send" | "devices" | "remove";
  conversationId?: string;
  peer?: string;
  content?: MlsDmContent;
  deviceId?: string;
};
type RelayReply = {
  id: string;
  mode?: DmSealingMode;
  problems?: ConversationProblems;
  devices?: OwnDevicesAnswer;
  error?: { code?: string; message: string };
};
type RelayChanged = { changed: string; conversationId: string | null };

const relayChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel(RELAY_CHANNEL) : null;
let relayListening = false;

function listenForRelay(): void {
  if (!relayChannel || relayListening) return;
  relayListening = true;
  relayChannel.addEventListener("message", (event: MessageEvent<RelayRequest>) => {
    const req = event.data;
    if (!req?.id || !req.op) return;
    const answer = (reply: Omit<RelayReply, "id">) => relayChannel.postMessage({ id: req.id, ...reply });
    const fail = (e: unknown) =>
      answer({ error: { code: (e as { code?: string })?.code, message: e instanceof Error ? e.message : String(e) } });
    if (req.op === "devices") return void ownDevicesHere(req.host).then((devices) => answer({ devices }), fail);
    if (req.op === "remove") return void removeHere(req.host, req.deviceId ?? "").then(() => answer({}), fail);
    const source = hosts.get(req.host)?.local;
    if (!source) return answer({ error: { message: "This server isn't connected in the other tab." } });
    const conversationId = req.conversationId ?? "";
    const peer = req.peer ?? "";
    const job =
      req.op === "mode"
        ? source.modeFor(conversationId, peer).then((mode) => ({ mode, problems: source.problems(conversationId) }))
        : source.send(conversationId, peer, req.content as MlsDmContent).then(() => ({}));
    job.then(answer, (e: unknown) =>
      answer({ error: { code: (e as { code?: string })?.code, message: e instanceof Error ? e.message : String(e) } }),
    );
  });
}

function askRelay(req: Omit<RelayRequest, "id">): Promise<RelayReply> {
  return new Promise<RelayReply>((resolve, reject) => {
    if (!relayChannel) return reject(new Error("No other tab to send through."));
    const id = crypto.randomUUID();
    const wait = req.op === "send" ? RELAY_SEND_TIMEOUT_MS : RELAY_TIMEOUT_MS;
    const timer = setTimeout(() => done(new Error("The tab sending encrypted messages didn't answer.")), wait);
    const onReply = (event: MessageEvent<RelayReply>) => {
      if (event.data?.id !== id) return;
      if (!event.data.error) return done(null, event.data);
      done(Object.assign(new Error(event.data.error.message), { code: event.data.error.code }));
    };
    const done = (error: Error | null, reply?: RelayReply) => {
      clearTimeout(timer);
      relayChannel.removeEventListener("message", onReply);
      if (error) reject(error);
      else resolve(reply!);
    };
    relayChannel.addEventListener("message", onReply);
    relayChannel.postMessage({ id, ...req });
  });
}

function relaySource(host: string): MlsSource {
  const problems = new Map<string, ConversationProblems>();
  const ask = (req: Omit<RelayRequest, "id" | "host">) => askRelay({ host, ...req });

  return {
    storeScope: identityScopeFor(host),
    async modeFor(conversationId, peer) {
      const reply = await ask({ op: "mode", conversationId, peer });
      problems.set(conversationId, reply.problems ?? NO_PROBLEMS);
      return reply.mode!;
    },
    send: async (conversationId, peer, content) => void (await ask({ op: "send", conversationId, peer, content })),
    problems: (conversationId) => problems.get(conversationId) ?? NO_PROBLEMS,
    waiting: () => false,
    onChange(listener) {
      const onMessage = (event: MessageEvent<RelayChanged>) => {
        if (event.data?.changed === host) listener(event.data.conversationId);
      };
      relayChannel?.addEventListener("message", onMessage);
      return () => relayChannel?.removeEventListener("message", onMessage);
    },
  };
}
