import { createMlsDmDriver, type MlsServerCapability, type MlsStateStore } from "@gryt/core";

import type { SeenOnMls } from "./seenOnMls.ts";
import type { ConversationProblems, MlsSession } from "./session.ts";
import { type AckSocket, socketMlsTransport } from "./transport.ts";

/**
 * How to send a DM without this device's archive. The driver decides, over an empty store; with
 * MLS on the server only its version 1 answers stand, and anything else waits for the archive.
 */

export type ModeOnlySource = Pick<MlsSession, "storeScope" | "modeFor" | "send" | "problems" | "onChange">;

const NO_PROBLEMS: ConversationProblems = { undecryptable: 0, lost: null };

const closed = () =>
  Promise.reject(Object.assign(new Error("This device's message history isn't open."), { code: "archive_closed" }));

/** Reads find nothing and writes throw, so no MLS state is made that the archive doesn't hold. */
const emptyStore: MlsStateStore = {
  loadDevice: async () => null,
  saveDevice: closed,
  putKeyPackages: closed,
  getKeyPackage: async () => null,
  listKeyPackages: async () => [],
  deleteKeyPackage: closed,
  loadGroup: async () => null,
  saveGroup: closed,
  deleteGroup: closed,
  listGroups: async () => [],
};

export function createModeOnlySource(options: {
  socket: AckSocket;
  storeScope: string;
  dmScope: string;
  serverUserId: string;
  capability: MlsServerCapability | null;
  getAccessToken: () => Promise<string | null>;
  seen: SeenOnMls;
}): ModeOnlySource {
  // Never started and never handed a socket event, so it can't register, join or ack anything.
  const driver = createMlsDmDriver({
    transport: socketMlsTransport({ socket: options.socket, getAccessToken: options.getAccessToken }),
    store: emptyStore,
    scope: options.dmScope,
    serverUserId: options.serverUserId,
    capability: options.capability,
    newDevice: closed,
    pins: {
      personOf: () => null,
      seenOnMls: (id) => options.seen.has(id),
      markSeenOnMls: (id) => options.seen.add(id),
    },
    events: { onMessage: () => undefined },
  });

  return {
    storeScope: options.storeScope,
    async modeFor(conversationId, peer) {
      const mode = await driver.modeFor(conversationId, peer);
      // With no MLS on the server the driver never reads the store, so every answer holds.
      if (!options.capability || mode.kind === "sealed-v1") return mode;
      return closed();
    },
    send: closed,
    problems: () => NO_PROBLEMS,
    onChange: () => () => undefined,
  };
}
