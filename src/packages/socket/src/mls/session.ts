import {
  createMlsDmDriver,
  type DmSealingMode,
  encodeMlsDmContent,
  type MlsDecryptedMessage,
  type MlsDeviceRecord,
  type MlsDmContent,
  type MlsDmDriver,
  type MlsLogEntry,
  type MlsOwnDevice,
  mlsPinsFromPeerPins,
  type MlsServerCapability,
  type MlsStateStore,
  type MlsWelcomeDelivery,
  readMlsDmContent,
} from "@gryt/core";
import { generateMlsKeyPackage, type PeerPinStore } from "@gryt/crypto";

import type { MessageArchive } from "@/common";

import { applyMlsContent } from "./applyContent.ts";
import type { SeenOnMls } from "./seenOnMls.ts";
import { type AckSocket, asBytes, socketMlsTransport } from "./transport.ts";

/**
 * One server's MLS: the @gryt/core DM driver, fed by this socket, writing what it decrypts
 * into the archive. The app decides nothing about MLS here; the driver does.
 */

export interface SessionSocket extends AckSocket {
  on(event: string, listener: (...args: never[]) => void): unknown;
  off(event: string, listener: (...args: never[]) => void): unknown;
}

/** What a DM shows besides its messages. */
export interface ConversationProblems {
  /** Messages that reached this device and couldn't be read. */
  undecryptable: number;
  /** This device is out of the group and can't read new messages until it's back. `device_removed`
      means out of every group on this server, since the server removed the device (GRYT-1555). */
  lost: "removed" | "out_of_sync" | "gap" | "device_removed" | null;
}

const NO_PROBLEMS: ConversationProblems = { undecryptable: 0, lost: null };

/** Hand the UI a turn every few messages, so a long catch-up doesn't freeze it. */
const YIELD_EVERY = 8;

export interface MlsSessionOptions {
  socket: SessionSocket;
  /** What the archive and the state store are keyed by: `identityScopeFor`. */
  storeScope: string;
  /** What keys are derived under: `dmScopeFor`. */
  dmScope: string;
  serverUserId: string;
  capability: MlsServerCapability | null;
  getAccessToken: () => Promise<string | null>;
  messages: MessageArchive;
  store: MlsStateStore;
  pinStore: PeerPinStore;
  seen: SeenOnMls;
  ownPersonKey: Uint8Array;
  newDevice: () => Promise<MlsDeviceRecord>;
  /** A message from somebody else that arrived live, once it's in the archive. For notifications. */
  onDelivered?: (message: { conversationId: string; senderId: string; content: MlsDmContent }) => void;
  /** The server removed this device here. The driver has stopped; the caller wipes and gates. */
  onDeviceRemoved?: () => void;
}

export interface MlsSession {
  readonly storeScope: string;
  readonly capability: MlsServerCapability | null;
  /** Catch up. Calls while one runs fold into one more run after it. */
  start(): Promise<void>;
  modeFor(conversationId: string, peer: string): Promise<DmSealingMode>;
  /** Sends and keeps this device's copy. One at a time per conversation. */
  send(conversationId: string, peer: string, content: MlsDmContent): Promise<void>;
  /** Who is in which DM, newest first, from `dm:list` and `dm:opened`. */
  noteConversations(conversations: { conversation_id: string; members: { server_user_id: string }[] }[]): void;
  problems(conversationId: string): ConversationProblems;
  /** Your devices on this server, named from their certificates where a group shows them. */
  ownDevices(): Promise<MlsOwnDevice[]>;
  /** Sends are held until the server is back, for a "Waiting for the server" label. */
  waiting(): boolean;
  /** One of your own devices, off the server. Peers drop it from each DM on their next pass. */
  removeOwnDevice(deviceId: string): Promise<void>;
  /** This device's MLS device id here, once it has one. */
  ownDeviceId(): Promise<string | null>;
  /** Something a DM screen shows may have moved: a mode, a problem, a join. */
  onChange(listener: (conversationId: string | null) => void): () => void;
  /** Stops taking work. Resolves once what was running is done, so the next session can't overlap it. */
  dispose(): Promise<void>;
}

export function createMlsSession(options: MlsSessionOptions): MlsSession {
  const { socket, storeScope, serverUserId: self, messages, store } = options;

  /** Newest first. Decides which group catches up first. */
  let recency: string[] = [];
  const members = new Map<string, string[]>();
  const problems = new Map<string, ConversationProblems>();
  const listeners = new Set<(conversationId: string | null) => void>();
  const placeholders = new Map<string, boolean>();
  const sending = new Map<string, Promise<unknown>>();
  let disposed = false;
  let waiting = false;
  /** Every driver call in flight. Two drivers on one store at once would fork the group state. */
  const inFlight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => {
    inFlight.add(p);
    const done = () => inFlight.delete(p);
    p.then(done, done);
    return p;
  };
  let handled = 0;
  /** Log entries that came as a push, so a catch-up after a week doesn't notify for each. */
  const pushed = new Set<string>();

  const changed = (conversationId: string | null) => {
    for (const listener of listeners) listener(conversationId);
  };

  const setProblems = (conversationId: string, next: Partial<ConversationProblems>) => {
    problems.set(conversationId, { ...(problems.get(conversationId) ?? NO_PROBLEMS), ...next });
    changed(conversationId);
  };

  const transport = socketMlsTransport({
    socket,
    getAccessToken: options.getAccessToken,
    placeholderFor: (conversationId) => placeholders.get(conversationId) ?? true,
    async remake(req, serverTime) {
      const device = await store.loadDevice();
      if (!device) return null;
      const make = async (lastResort: boolean) => ({
        ...(await generateMlsKeyPackage(device, serverTime)),
        lastResort,
        createdAt: Date.now(),
      });
      const fresh = await Promise.all(req.keyPackages.map(() => make(false)));
      const last = req.lastResort ? await make(true) : undefined;
      await store.putKeyPackages(last ? [...fresh, last] : fresh);
      return { deviceId: req.deviceId, keyPackages: fresh.map((k) => k.keyPackage), lastResort: last?.keyPackage };
    },
  });

  async function membersOf(conversationId: string): Promise<string[]> {
    const known = members.get(conversationId);
    if (known) return [self, ...known];
    // A Welcome can land before `dm:opened`. The server lists who has devices there.
    const r = await transport.listDevices({ conversationId });
    const ids = r.ok ? [...new Set(r.devices.map((d) => d.serverUserId))].filter((id) => id !== self) : [];
    if (ids.length) members.set(conversationId, ids);
    return [self, ...ids];
  }

  const ordered: MlsStateStore = {
    loadDevice: () => store.loadDevice(),
    saveDevice: (d) => store.saveDevice(d),
    putKeyPackages: (r) => store.putKeyPackages(r),
    getKeyPackage: (r) => store.getKeyPackage(r),
    listKeyPackages: () => store.listKeyPackages(),
    deleteKeyPackage: (r) => store.deleteKeyPackage(r),
    loadGroup: (c) => store.loadGroup(c),
    saveGroup: (g) => store.saveGroup(g),
    deleteGroup: (c) => store.deleteGroup(c),
    async listGroups() {
      const rank = (id: string) => {
        const i = recency.indexOf(id);
        return i === -1 ? recency.length : i;
      };
      return (await store.listGroups()).sort((a, b) => rank(a.conversationId) - rank(b.conversationId));
    },
  };

  async function received(m: MlsDecryptedMessage): Promise<void> {
    const content = readMlsDmContent(m.plaintext);
    // Something a newer app sent, a new kind of content: skipped, not counted as broken.
    if (content === "newer") return;
    if (!content) {
      setProblems(m.conversationId, { undecryptable: (problems.get(m.conversationId)?.undecryptable ?? 0) + 1 });
      return;
    }
    await apply(m.conversationId, m.senderServerUserId, m.senderDeviceId, content, Date.parse(m.createdAt) || Date.now());
    if (pushed.delete(`${m.conversationId}:${m.seq}`) && content.type === "message" && m.senderServerUserId !== self) {
      options.onDelivered?.({ conversationId: m.conversationId, senderId: m.senderServerUserId, content });
    }
    if (++handled % YIELD_EVERY === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const apply = (conversationId: string, senderId: string, senderDeviceId: string | undefined, content: MlsDmContent, at: number) =>
    applyMlsContent(messages, { scope: storeScope, conversationId, senderId, senderDeviceId, content, at });

  const driver: MlsDmDriver = createMlsDmDriver({
    transport,
    store: ordered,
    scope: options.dmScope,
    serverUserId: self,
    capability: options.capability,
    newDevice: options.newDevice,
    pins: mlsPinsFromPeerPins({
      store: options.pinStore,
      scope: options.dmScope,
      serverUserId: self,
      ownPersonKey: options.ownPersonKey,
      membersOf,
      seen: options.seen,
    }),
    events: {
      onMessage: received,
      onUndecryptable: ({ conversationId }) =>
        setProblems(conversationId, { undecryptable: (problems.get(conversationId)?.undecryptable ?? 0) + 1 }),
      onGroupLost: ({ conversationId, reason }) => setProblems(conversationId, { lost: reason }),
      onJoined: ({ conversationId }) => setProblems(conversationId, { lost: null }),
      onDeviceRemoved: () => options.onDeviceRemoved?.(),
      onWaiting: (next) => {
        waiting = next;
        changed(null);
      },
    },
  });

  let running: Promise<void> | null = null;
  let again = false;

  function start(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = track((async () => {
      do {
        again = false;
        try {
          await driver.start();
        } catch (e) {
          console.warn("[MLS] Catching up failed:", e);
        }
      } while (again && !disposed);
      running = null;
      changed(null);
    })());
    return running;
  }

  const safely = (what: string, job: () => Promise<void>) => {
    if (disposed) return;
    track(job()).catch((e: unknown) => console.warn(`[MLS] ${what} failed:`, e));
  };

  const onEntry = (raw: MlsLogEntry) => {
    if (raw?.kind === "application") pushed.add(`${raw.conversationId}:${raw.seq}`);
    safely("A pushed message", () => driver.handleMessage({ ...raw, data: asBytes(raw.data) }));
  };
  const onWelcome = (raw: MlsWelcomeDelivery) =>
    safely("A Welcome", () => driver.handleWelcome({ ...raw, data: asBytes(raw.data) }));
  const onDevices = (push: { serverUserId: string }) =>
    safely("A device change", async () => {
      await driver.handleDevicesChanged(push);
      changed(null);
    });
  const onOpened = (conversation: { conversation_id: string; members: { server_user_id: string }[] }) => {
    if (!conversation?.conversation_id) return;
    recency = [conversation.conversation_id, ...recency.filter((id) => id !== conversation.conversation_id)];
    members.set(conversation.conversation_id, conversation.members.map((m) => m.server_user_id));
    void start();
  };
  const onListed = (payload: { items?: { conversation_id: string; members: { server_user_id: string }[] }[] }) => {
    if (Array.isArray(payload?.items)) session.noteConversations(payload.items);
  };

  socket.on("mls:message", onEntry);
  socket.on("mls:welcome", onWelcome);
  socket.on("mls:devices:changed", onDevices);
  socket.on("dm:opened", onOpened);
  socket.on("dm:list", onListed);

  const session: MlsSession = {
    storeScope,
    capability: options.capability,
    start,
    modeFor: (conversationId, peer) => driver.modeFor(conversationId, peer),

    send(conversationId, peer, content) {
      if (disposed) return Promise.reject(new Error("This connection has closed."));
      const previous = sending.get(conversationId) ?? Promise.resolve();
      const job = previous.catch(() => undefined).then(async () => {
        // Only a new message leaves a line for apps from before MLS (GRYT-1517).
        placeholders.set(conversationId, content.type === "message");
        const attachmentIds = content.type === "message" ? Object.keys(content.attachments ?? {}) : [];
        try {
          await driver.send(conversationId, peer, encodeMlsDmContent(content), { attachmentIds });
        } finally {
          placeholders.delete(conversationId);
        }
        // Our own sends never come back to this device, so this is the only copy here.
        await apply(conversationId, self, undefined, content, Date.now());
      });
      sending.set(conversationId, job);
      return track(job);
    },

    noteConversations(list) {
      recency = list.map((c) => c.conversation_id);
      for (const c of list) members.set(c.conversation_id, c.members.map((m) => m.server_user_id));
    },
    problems: (conversationId) => problems.get(conversationId) ?? NO_PROBLEMS,
    ownDevices() {
      if (disposed) return Promise.reject(new Error("This connection has closed."));
      return track(driver.ownDevices());
    },
    waiting: () => waiting,
    removeOwnDevice(deviceId) {
      if (disposed) return Promise.reject(new Error("This connection has closed."));
      return track(driver.removeOwnDevice(deviceId).then(() => changed(null)));
    },
    ownDeviceId: async () => (await store.loadDevice())?.deviceId ?? null,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      disposed = true;
      // What's still waiting for the server fails now, or this would wait out the driver's cap.
      driver.stop();
      listeners.clear();
      socket.off("mls:message", onEntry);
      socket.off("mls:welcome", onWelcome);
      socket.off("mls:devices:changed", onDevices);
      socket.off("dm:opened", onOpened);
      socket.off("dm:list", onListed);
      await Promise.allSettled([...inFlight]);
    },
  };
  return session;
}
