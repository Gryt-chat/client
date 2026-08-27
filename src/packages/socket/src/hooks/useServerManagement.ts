import { useCallback, useEffect, useMemo, useState } from "react";

import { singletonHook } from "@/common";
import {
  forgetHost,
  listHostExpectations,
  listPins,
  normalizeHost,
  removeServerAccessToken,
  removeServerRefreshToken,
} from "@/common";
import { useLanDiscovery } from "@/settings/src/hooks/useLanDiscovery";
import { useServerSettings } from "@/settings/src/hooks/useServerSettings";
import { orderServerHosts } from "@/settings/src/serverOrder";
import { Server, Servers } from "@/settings/src/types/server";

import { type LanServer } from "../../../../lib/electron";
import { useSockets } from "./useSockets";

interface ServerManagement {
  servers: Servers;
  currentlyViewingServer: Server | null;
  showAddServer: boolean;
  showRemoveServer: string | null;
  showDiscovery: boolean;
  orderedServerHosts: string[];
  pendingLanServers: LanServer[];
  /** Discovered, not joined, and not looked at yet. What the rail badge means. */
  newLanServers: LanServer[];

  /**
   * Addresses that turn out to be one server, keyed by its identity key.
   *
   * Only groups of two or more. A host not in any group has no duplicate.
   */
  duplicateHostGroups: Record<string, string[]>;
  /** The other addresses this same server is also in the rail under. */
  duplicatesOf: (host: string) => string[];

  addServer: (server: Server, focusNewServer?: boolean) => void;
  /** Fold every other entry for this server into `keepHost`. */
  mergeDuplicates: (keepHost: string) => void;
  removeServer: (host: string) => void;
  removeServers: (hosts: string[]) => void;
  switchToServer: (host: string) => void;
  reconnectServer: (host: string) => void;
  reorderServers: (orderedHosts: string[]) => void;
  setShowAddServer: (show: boolean) => void;
  setShowRemoveServer: (host: string | null) => void;
  setShowDiscovery: (show: boolean) => void;
  dismissLanServer: (key: string) => void;
  markLanServersSeen: (keys: string[]) => void;

  getServer: (host: string) => Server | undefined;
  getAllServers: () => Server[];
  hasServer: (host: string) => boolean;
  getServerCount: () => number;
  getLastSelectedChannel: (host: string) => string | null;
  setLastSelectedChannelForServer: (host: string, channelId: string) => void;
}

export function lanServerAddr(s: LanServer): string {
  return s.port === 443 ? s.host : `${s.host}:${s.port}`;
}

/** How a discovered server is identified in the dismissed and seen lists. */
export function lanServerKey(s: LanServer): string {
  return `${s.host}:${s.port}`;
}

function useServerManagementHook(): ServerManagement {
  const {
    servers,
    setServers,
    currentlyViewingServer,
    setCurrentlyViewingServer,
    lastSelectedChannels,
    setLastSelectedChannel,
    forgetLastSelectedChannels,
    serverOrder,
    setServerOrder,
    dismissedLanServers,
    dismissLanServer,
    seenLanServers,
    markLanServersSeen,
  } = useServerSettings();

  const { lanServers } = useLanDiscovery();
  const { serverDetailsList } = useSockets();

  // Write down a server's id once we are actually talking to it.
  //
  // addServer already refuses to add a server it recognises by id, so the
  // second entry only appears when the id was unknown at the time — the /info
  // fetch did not land, or it was typed in by address and never fetched. The
  // id was then never learned at all, because nothing wrote it after the fact,
  // so the dedupe could not fire on any later attempt either.
  //
  // The socket reports it on every connection, so take it from there. One
  // server reached two ways — 127.0.0.1:port from My servers and
  // <machine>.local:port from Discovery — stops being addable twice as soon as
  // either address has been connected to once. GRYT-224.
  useEffect(() => {
    const learned: Record<string, string> = {};

    for (const [host, details] of Object.entries(serverDetailsList)) {
      const id = details?.server_info?.server_id;
      if (!id) continue;
      const stored = servers[host];
      if (!stored || stored.serverId === id) continue;
      learned[host] = id;
    }

    if (Object.keys(learned).length === 0) return;

    // setServers takes a value, not an updater, so this writes the map built
    // from the `servers` this effect ran against. It is guarded on `learned`
    // being non-empty above and on the id differing, so a repeat render with
    // the same data does not write again and cannot loop.
    setServers({ ...servers, ...Object.fromEntries(
      Object.entries(learned).map(([host, id]) => [
        host,
        { ...servers[host], serverId: id },
      ]),
    ) });
  }, [serverDetailsList, servers, setServers]);

  const [showAddServer, setShowAddServer] = useState(false);
  const [showRemoveServer, setShowRemoveServer] = useState<string | null>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [pendingFocusServer, setPendingFocusServer] = useState<string | null>(
    null
  );

  const findServerById = useCallback(
    (serverId?: string): [string, Server] | null => {
      if (!serverId) return null;

      const entry = Object.entries(servers).find(
        ([, server]) => !!server.serverId && server.serverId === serverId
      );

      return entry ?? null;
    },
    [servers]
  );

  const pendingLanServers = useMemo(() => {
    return lanServers.filter((s) => {
      const addr = lanServerAddr(s);
      const normalized = normalizeHost(addr);
      const key = lanServerKey(s);

      if (servers[normalized]) return false;
      if (dismissedLanServers.includes(key)) return false;

      /* There used to be a second check here, hiding a found server whose
       * `serverId` matched one already added. It compared two different fields
       * that share a name: `s.serverId` is the mDNS TXT record's `server_id`,
       * which is `SERVER_INSTANCE_ID || "default"` and is a per-host
       * disambiguator, while a stored `serverId` is `/info`'s — a real
       * per-install identity, or the socket's `<name>_<port>_<instance>`.
       *
       * So it never matched the thing it was written to match, and the only
       * way it could fire was by accident: set `SERVER_INSTANCE_ID` on two
       * machines to the same value and Discovery would hide the second one.
       * The address check above is what actually deduplicates, and GRYT-224's
       * id learning is what makes *that* work across two addresses for one
       * server. GRYT-485. */

      return true;
    });
  }, [lanServers, servers, dismissedLanServers]);

  /**
   * What the badge on the rail counts.
   *
   * Not what is on the network: six servers run on this machine alone, and a
   * count of those would sit permanently at six and carry no information. This
   * is the ones that have turned up since Discovery was last open, which does
   * empty when somebody looks, so it is worth showing as a number rather than
   * a dot.
   */
  const newLanServers = useMemo(
    () => pendingLanServers.filter((s) => !seenLanServers.includes(lanServerKey(s))),
    [pendingLanServers, seenLanServers],
  );

  /* Shared with the launch focus in useServerSettings, which opens the first
     of these. See orderServerHosts. */
  const orderedServerHosts = useMemo(
    () => orderServerHosts(servers, serverOrder),
    [servers, serverOrder]
  );

  const reorderServers = useCallback(
    (orderedHosts: string[]) => {
      setServerOrder(orderedHosts);
    },
    [setServerOrder]
  );

  useEffect(() => {
    if (pendingFocusServer && servers[pendingFocusServer]) {
      setCurrentlyViewingServer(pendingFocusServer);
      setPendingFocusServer(null);
    }
  }, [servers, pendingFocusServer, setCurrentlyViewingServer]);

  const addServer = useCallback(
    (incomingServer: Server, focusNewServer: boolean = true) => {
      // Joining from Discovery is the common route now, and landing on the
      // server you just joined is the point of it.
      if (focusNewServer) setShowDiscovery(false);

      const normalizedHost = normalizeHost(incomingServer.host);
      const normalizedIncoming: Server = {
        ...incomingServer,
        host: normalizedHost,
      };

      const existingByHost = servers[normalizedHost];
      if (existingByHost) {
        const nextServer: Server = {
          ...existingByHost,
          ...normalizedIncoming,
          token:
            typeof normalizedIncoming.token === "string" &&
            normalizedIncoming.token.length > 0
              ? normalizedIncoming.token
              : existingByHost.token,
          serverId:
            normalizedIncoming.serverId &&
            normalizedIncoming.serverId.length > 0
              ? normalizedIncoming.serverId
              : existingByHost.serverId,
        };

        const unchanged =
          nextServer.name === existingByHost.name &&
          nextServer.host === existingByHost.host &&
          nextServer.token === existingByHost.token &&
          nextServer.serverId === existingByHost.serverId;

        if (unchanged) {
          if (focusNewServer) setCurrentlyViewingServer(existingByHost.host);
          setShowAddServer(false);
          return;
        }

        const newServers = { ...servers, [normalizedHost]: nextServer };
        setServers(newServers);

        if (focusNewServer) setCurrentlyViewingServer(nextServer.host);
        setShowAddServer(false);
        return;
      }

      const existingById = findServerById(normalizedIncoming.serverId);
      if (existingById) {
        const [existingHost, existingServer] = existingById;

        const mergedServer: Server = {
          ...existingServer,
          name: normalizedIncoming.name || existingServer.name,
          token:
            typeof normalizedIncoming.token === "string" &&
            normalizedIncoming.token.length > 0
              ? normalizedIncoming.token
              : existingServer.token,
          serverId:
            normalizedIncoming.serverId &&
            normalizedIncoming.serverId.length > 0
              ? normalizedIncoming.serverId
              : existingServer.serverId,
          host: existingHost,
        };

        const newServers = {
          ...servers,
          [existingHost]: mergedServer,
        };

        setServers(newServers);

        if (focusNewServer) setCurrentlyViewingServer(existingHost);
        setShowAddServer(false);
        return;
      }

      const newServers = { ...servers, [normalizedHost]: normalizedIncoming };
      setServers(newServers);

      if (focusNewServer) {
        setPendingFocusServer(normalizedHost);
      }

      setShowAddServer(false);
    },
    [servers, setServers, setCurrentlyViewingServer, findServerById]
  );

  /**
   * The pairs GRYT-224 stopped making but could not undo.
   *
   * Keyed on the server's identity key, not on `serverId`. GRYT-317 was
   * written assuming `serverId` names a server, and it does not: the socket
   * reports `<name>_<port>_<instance>` (`computeServerId` in the server's
   * `utils/serverId.ts`), which exists to tell two servers on one host apart.
   * Two people each running an unconfigured server both publish the same
   * string, so grouping the rail on it would offer to merge two entries that
   * are different servers — the same shape as GRYT-485, with a deletion on the
   * end of it.
   *
   * The identity key does name a server. It is what the pin is for, and
   * `originKeyId` carries it across rotations, so it survives the one event
   * that would otherwise split a server in two.
   *
   * The cost is that this only sees addresses that have been connected to at
   * least once, because that is when a pin is written. An entry typed in and
   * never reached is not grouped with anything, which is the right answer
   * anyway: nothing has established what is at that address.
   */
  const [hostIdentities, setHostIdentities] = useState<Record<string, string>>(
    {},
  );

  // Pins are written when a connection is established, so serverDetailsList
  // changing is the render this needs to re-read on. The comparison keeps the
  // object identity stable when nothing moved, so the grouping below does not
  // recompute on every connection event.
  useEffect(() => {
    const expectations = listHostExpectations();
    const pins = listPins();

    const next: Record<string, string> = {};
    for (const [host, keyId] of Object.entries(expectations)) {
      next[host] = pins[keyId]?.originKeyId ?? keyId;
    }

    setHostIdentities((prev) => {
      const prevKeys = Object.keys(prev);
      const unchanged =
        prevKeys.length === Object.keys(next).length &&
        prevKeys.every((host) => prev[host] === next[host]);
      return unchanged ? prev : next;
    });
  }, [serverDetailsList]);

  const duplicateHostGroups = useMemo(() => {
    const byIdentity: Record<string, string[]> = {};

    for (const host of orderedServerHosts) {
      const identity = hostIdentities[host];
      if (!identity) continue;
      (byIdentity[identity] ??= []).push(host);
    }

    return Object.fromEntries(
      Object.entries(byIdentity).filter(([, hosts]) => hosts.length > 1),
    );
  }, [orderedServerHosts, hostIdentities]);

  const duplicatesOf = useCallback(
    (host: string) =>
      Object.values(duplicateHostGroups)
        .find((hosts) => hosts.includes(host))
        ?.filter((h) => h !== host) ?? [],
    [duplicateHostGroups],
  );

  const mergeDuplicates = useCallback(
    (keepHost: string) => {
      const normalizedKeep = normalizeHost(keepHost);
      const survivor = servers[normalizedKeep];
      if (!survivor) return;

      const dropped =
        Object.values(duplicateHostGroups)
          .find((hosts) => hosts.includes(normalizedKeep))
          ?.filter((host) => host !== normalizedKeep) ?? [];
      if (dropped.length === 0) return;

      const inheritedToken =
        typeof survivor.token === "string" && survivor.token.length > 0
          ? survivor.token
          : dropped
              .map((host) => servers[host]?.token)
              .find((token) => typeof token === "string" && token.length > 0);

      const newServers = { ...servers };
      for (const host of dropped) {
        delete newServers[host];
        removeServerAccessToken(host);
        removeServerRefreshToken(host);
        forgetHost(host);
      }
      newServers[normalizedKeep] = { ...survivor, token: inheritedToken };
      setServers(newServers);

      // The survivor takes the earliest place any of the group held, so a
      // merge does not send the entry to the bottom of the rail.
      const groupHosts = new Set([normalizedKeep, ...dropped]);
      const firstIndex = serverOrder.findIndex((host) => groupHosts.has(host));
      const remaining = serverOrder.filter((host) => !groupHosts.has(host));
      if (firstIndex !== -1) {
        const before = serverOrder
          .slice(0, firstIndex)
          .filter((host) => !groupHosts.has(host));
        setServerOrder([
          ...before,
          normalizedKeep,
          ...remaining.slice(before.length),
        ]);
      } else {
        setServerOrder([...remaining, normalizedKeep]);
      }

      if (!lastSelectedChannels[normalizedKeep]) {
        const inheritedChannel = dropped
          .map((host) => lastSelectedChannels[host])
          .find(Boolean);
        if (inheritedChannel) {
          setLastSelectedChannel(normalizedKeep, inheritedChannel);
        }
      }

      forgetLastSelectedChannels(dropped);

      // Merging the entry you are looking at should leave you looking at the
      // same server, not at whatever happens to be first.
      if (
        currentlyViewingServer &&
        dropped.includes(currentlyViewingServer.host)
      ) {
        setCurrentlyViewingServer(normalizedKeep);
      }
    },
    [
      servers,
      setServers,
      duplicateHostGroups,
      serverOrder,
      setServerOrder,
      lastSelectedChannels,
      setLastSelectedChannel,
      forgetLastSelectedChannels,
      currentlyViewingServer,
      setCurrentlyViewingServer,
    ],
  );

  /**
   * Leaving a server, and meaning it.
   *
   * This used to remove the sidebar entry and stop there, which left two things
   * behind that only make sense for a member. The tokens: being kicked drops
   * both, and the comment there says keeping the refresh token is what let a
   * kicked client mint a new access token and walk back in — leaving
   * voluntarily should not keep the credential either.
   *
   * And the pinned identity, which is the one people actually hit. It outlived
   * the membership, so rebuilding a server on the same address was refused with
   * a message pointing at a settings screen you had to already know about.
   */
  /**
   * The same, for every address one server was reachable at.
   *
   * Deleting a server you host has to forget all of them at once. Calling
   * removeServer in a loop cannot do it: `servers` is state read out of this
   * closure, so the second call rebuilds the map from the version that still
   * holds the first call's entry, and writes it back — one removal survives,
   * and the persisted copy is the wrong one.
   */
  const removeServers = useCallback(
    (hosts: string[]) => {
      const normalized = hosts.map(normalizeHost).filter(Boolean);
      if (normalized.length === 0) return;

      const newServers = { ...servers };
      for (const host of normalized) {
        delete newServers[host];

        removeServerAccessToken(host);
        removeServerRefreshToken(host);
        forgetHost(host);
      }
      setServers(newServers);

      if (
        currentlyViewingServer &&
        normalized.includes(currentlyViewingServer.host)
      ) {
        const remainingServers = Object.values(newServers) as Server[];
        setCurrentlyViewingServer(
          remainingServers.length > 0 ? remainingServers[0].host : null
        );
      }

      setShowRemoveServer(null);
    },
    [servers, setServers, currentlyViewingServer, setCurrentlyViewingServer]
  );

  const removeServer = useCallback(
    (host: string) => {
      removeServers([host]);
    },
    [removeServers]
  );

  /**
   * Being kicked or banned takes the server out of the sidebar.
   *
   * The socket layer knows it happened but cannot reach `removeServer`, so it
   * dispatches a window event and this picks it up — the same hop
   * `server_settings_open` and `server_voice_disconnect` already use.
   *
   * `removeServer` is the whole removal: it drops the entry, and switches away
   * if you were looking at it. The socket is closed by the effect in useSockets
   * that watches for a host leaving the list — without that the client would
   * reconnect and put the server straight back.
   */
  useEffect(() => {
    const handler = (event: Event) => {
      const host = (event as CustomEvent<{ host?: string }>).detail?.host;
      if (host) removeServer(host);
    };
    window.addEventListener("server_force_remove", handler);
    return () => window.removeEventListener("server_force_remove", handler);
  }, [removeServer]);

  const switchToServer = useCallback(
    (host: string) => {
      const normalizedHost = normalizeHost(host);
      if (!servers[normalizedHost]) {
        console.error(
          "Cannot switch to server - server not found:",
          normalizedHost
        );
        return;
      }

      // Discovery is a destination in the same rail, so picking a server has to
      // leave it. Without this the server switches underneath a pane that is
      // still showing the network list, and the rail highlight lies.
      setShowDiscovery(false);
      setCurrentlyViewingServer(normalizedHost);
    },
    [setCurrentlyViewingServer, servers]
  );

  const getServer = useCallback(
    (host: string): Server | undefined => {
      return servers[normalizeHost(host)];
    },
    [servers]
  );

  const getAllServers = useCallback((): Server[] => {
    return Object.values(servers);
  }, [servers]);

  const hasServer = useCallback(
    (host: string): boolean => {
      return normalizeHost(host) in servers;
    },
    [servers]
  );

  const getServerCount = useCallback((): number => {
    return Object.keys(servers).length;
  }, [servers]);

  const getLastSelectedChannel = useCallback(
    (host: string): string | null => {
      return lastSelectedChannels[normalizeHost(host)] || null;
    },
    [lastSelectedChannels]
  );

  const setLastSelectedChannelForServer = useCallback(
    (host: string, channelId: string) => {
      setLastSelectedChannel(normalizeHost(host), channelId);
    },
    [setLastSelectedChannel]
  );

  const reconnectServer = useCallback(
    (host: string) => {
      const normalizedHost = normalizeHost(host);
      if (!servers[normalizedHost]) {
        console.error(
          "Cannot reconnect to server - server not found:",
          normalizedHost
        );
        return;
      }
    },
    [servers]
  );

  return {
    servers,
    currentlyViewingServer,
    showAddServer,
    showRemoveServer,
    showDiscovery,
    orderedServerHosts,
    pendingLanServers,
    newLanServers,

    duplicateHostGroups,
    duplicatesOf,
    addServer,
    mergeDuplicates,
    removeServer,
    removeServers,
    switchToServer,
    reconnectServer,
    reorderServers,
    setShowAddServer,
    setShowRemoveServer,
    setShowDiscovery,
    dismissLanServer,
    markLanServersSeen,

    getServer,
    getAllServers,
    hasServer,
    getServerCount,
    getLastSelectedChannel,
    setLastSelectedChannelForServer,
  };
}

const init: ServerManagement = {
  servers: {},
  currentlyViewingServer: null,
  showAddServer: false,
  showRemoveServer: null,
  showDiscovery: false,
  orderedServerHosts: [],
  pendingLanServers: [],
  newLanServers: [],

  duplicateHostGroups: {},
  duplicatesOf: () => [],
  addServer: () => {},
  mergeDuplicates: () => {},
  removeServer: () => {},
  removeServers: () => {},
  switchToServer: () => {},
  reconnectServer: () => {},
  reorderServers: () => {},
  setShowAddServer: () => {},
  setShowRemoveServer: () => {},
  setShowDiscovery: () => {},
  dismissLanServer: () => {},
  markLanServersSeen: () => {},

  getServer: () => undefined,
  getAllServers: () => [],
  hasServer: () => false,
  getServerCount: () => 0,
  getLastSelectedChannel: () => null,
  setLastSelectedChannelForServer: () => {},
};

export const useServerManagement = singletonHook(init, useServerManagementHook);
