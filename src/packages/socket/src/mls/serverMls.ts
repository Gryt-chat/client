import type { DmSealingMode, MlsDmContent, MlsServerCapability } from "@gryt/core";
import { useSyncExternalStore } from "react";
import type { Socket } from "socket.io-client";

import {
  claimMlsWorker,
  getLocalArchiveSnapshot,
  getOwnServerUserId,
  getServerAccessToken,
  identityScopeFor,
  localPeerPinStore,
  type MlsWorkerClaim,
  newMlsDevice,
  openLocalArchive,
  ownPersonPublicKey,
  personKeyBindingFor,
  subscribeToLocalArchive,
} from "@/common";

import { isElectron } from "../../../../lib/electron";
import { readMlsCapability } from "./capability";
import { publishPersonKey } from "./publishPersonKey";
import { seenOnMlsFor } from "./seenOnMls";
import { type ConversationProblems, createMlsSession, type MlsSession, type SessionSocket } from "./session";

/**
 * MLS for every connected server. Only the tab holding the Web Lock runs a driver; the
 * others ask it over a BroadcastChannel and read the archive (design, section 5).
 */

/** What a DM view needs, whether the driver is in this tab or another one. */
export type MlsSource = Pick<MlsSession, "storeScope" | "modeFor" | "send" | "problems" | "onChange">;

/** How long to wait for the member list's pins before starting anyway. */
const MEMBERS_WAIT_MS = 5000;
const RELAY_TIMEOUT_MS = 20_000;
const RELAY_CHANNEL = "gryt-mls-relay";
const NO_PROBLEMS: ConversationProblems = { undecryptable: 0, lost: null };

interface HostState {
  socket: Socket;
  /** Undefined until `server:info` says, null when the server has no MLS. */
  capability: MlsServerCapability | null | undefined;
  ready: boolean;
  pinned: { promise: Promise<void>; resolve: () => void };
  session: MlsSession | null;
  sessionKey: string | null;
  /** The previous session's work. The next one waits, so two drivers never share a store. */
  retiring: Promise<void>;
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
    sessionKey: null,
    retiring: previous ? retire(host, previous) : Promise.resolve(),
  };
  hosts.set(host, state);

  socket.on("server:info", (info: { mls?: unknown }) => {
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

function retire(host: string, state: HostState): Promise<void> {
  const session = state.session;
  state.session = null;
  if (hosts.get(host) === state) setSource(host, null);
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
      state.retiring = state.retiring.then(() => retire(host, state));
      await state.retiring;
      const [archive, ownPersonKey] = await Promise.all([openLocalArchive(), ownPersonPublicKey(host)]);
      if (hosts.get(host) !== state || state.sessionKey !== key) return;
      const scope = identityScopeFor(host);
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
      });
      state.session.onChange((conversationId) => relayChannel?.postMessage({ changed: host, conversationId }));
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
        if (code !== "unknown_device" && code !== "invalid_device") {
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

// ── Other tabs ask the one holding the lock ─────────────────────────────

type RelayRequest = { id: string; host: string; op: "mode" | "send"; conversationId: string; peer: string; content?: MlsDmContent };
type RelayReply = { id: string; mode?: DmSealingMode; problems?: ConversationProblems; error?: { code?: string; message: string } };
type RelayChanged = { changed: string; conversationId: string | null };

const relayChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel(RELAY_CHANNEL) : null;
let relayListening = false;

function listenForRelay(): void {
  if (!relayChannel || relayListening) return;
  relayListening = true;
  relayChannel.addEventListener("message", (event: MessageEvent<RelayRequest>) => {
    const req = event.data;
    if (!req?.id || !req.op) return;
    const session = hosts.get(req.host)?.session;
    const answer = (reply: Omit<RelayReply, "id">) => relayChannel.postMessage({ id: req.id, ...reply });
    if (!session) return answer({ error: { message: "This server isn't connected in the other tab." } });
    const job =
      req.op === "mode"
        ? session.modeFor(req.conversationId, req.peer).then((mode) => ({ mode, problems: session.problems(req.conversationId) }))
        : session.send(req.conversationId, req.peer, req.content as MlsDmContent).then(() => ({}));
    job.then(answer, (e: unknown) =>
      answer({ error: { code: (e as { code?: string })?.code, message: e instanceof Error ? e.message : String(e) } }),
    );
  });
}

function relaySource(host: string): MlsSource {
  const problems = new Map<string, ConversationProblems>();
  const ask = (req: Omit<RelayRequest, "id" | "host">) =>
    new Promise<RelayReply>((resolve, reject) => {
      if (!relayChannel) return reject(new Error("No other tab to send through."));
      const id = crypto.randomUUID();
      const timer = setTimeout(() => done(new Error("The tab sending encrypted messages didn't answer.")), RELAY_TIMEOUT_MS);
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
      relayChannel.postMessage({ id, host, ...req });
    });

  return {
    storeScope: identityScopeFor(host),
    async modeFor(conversationId, peer) {
      const reply = await ask({ op: "mode", conversationId, peer });
      problems.set(conversationId, reply.problems ?? NO_PROBLEMS);
      return reply.mode!;
    },
    send: async (conversationId, peer, content) => void (await ask({ op: "send", conversationId, peer, content })),
    problems: (conversationId) => problems.get(conversationId) ?? NO_PROBLEMS,
    onChange(listener) {
      const onMessage = (event: MessageEvent<RelayChanged>) => {
        if (event.data?.changed === host) listener(event.data.conversationId);
      };
      relayChannel?.addEventListener("message", onMessage);
      return () => relayChannel?.removeEventListener("message", onMessage);
    },
  };
}
