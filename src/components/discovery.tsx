import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  IconButton,
  Separator,
  Spinner,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";
import {
  PiArrowsClockwiseBold,
  PiBroadcastFill,
  PiWarningFill,
} from "react-icons/pi";

import { GeneratedServerIcon, getServerHttpBase, normalizeHost } from "@/common";
import { useLanDiscovery } from "@/settings/src/hooks/useLanDiscovery";
import { fetchServerInfo, useServerJoin } from "@/settings/src/hooks/useServerJoin";
import {
  lanServerAddr,
  lanServerKey,
  useServerManagement,
} from "@/socket/src/hooks/useServerManagement";

import type { LanServer } from "../lib/electron";

/**
 * How long the pane looks before admitting it has found nothing.
 *
 * Discovery never stops — this only decides when to stop saying "searching".
 * Servers that appear later still show up, replacing the empty state.
 */
const EMPTY_AFTER_MS = 4000;

/**
 * Servers on this network, as a destination rather than a section of a modal.
 *
 * It used to sit inside the join dialog, which meant you only found out your
 * network had servers on it while you were already trying to join one by
 * address — and the list fought the address field for the same column.
 */
export function Discovery() {
  const { lanServers, rescan } = useLanDiscovery();
  const { servers, setShowAddServer, markLanServersSeen, switchToServer } =
    useServerManagement();
  const { join, joiningHost } = useServerJoin();

  const [searchExpired, setSearchExpired] = useState(false);
  /** Whichever row's join failed, and why. Keyed so only that row says it. */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [connecting, setConnecting] = useState<string | null>(null);

  // Arriving here is the "look" the badge is counted against. Anything on
  // screen right now stops being new, including servers that appear while the
  // pane is open — they are being looked at as they arrive.
  //
  // Flattened to a string on purpose: useLanDiscovery builds a fresh array
  // every render, so a dependency on the array itself would re-run this on
  // every render of the pane.
  const visibleKeys = lanServers.map(lanServerKey).join("|");
  useEffect(() => {
    if (!visibleKeys) return;
    markLanServersSeen(visibleKeys.split("|"));
  }, [visibleKeys, markLanServersSeen]);

  // A fresh scan on arrival rather than whatever was found at launch.
  // Discovery announces each server once, so without this the list is only
  // ever as current as the moment the app started.
  useEffect(() => {
    rescan();

    setSearchExpired(false);
    const timer = window.setTimeout(() => setSearchExpired(true), EMPTY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [rescan]);

  const handleJoin = useCallback(
    async (server: LanServer) => {
      const key = lanServerKey(server);
      const host = normalizeHost(lanServerAddr(server));

      setRowErrors((prev) => ({ ...prev, [key]: "" }));
      setConnecting(key);

      try {
        const result = await fetchServerInfo(host);
        if (result.kind === "superseded") return;
        if (result.kind === "error") {
          setRowErrors((prev) => ({ ...prev, [key]: result.message }));
          return;
        }

        const outcome = await join({
          host,
          info: result.kind === "info" ? result.info : null,
        });

        if (!outcome.ok) {
          setRowErrors((prev) => ({ ...prev, [key]: outcome.message }));
        }
      } finally {
        setConnecting(null);
      }
    },
    [join],
  );

  const busy = connecting !== null || joiningHost !== null;

  return (
    <Flex direction="column" flexGrow="1" gap="4" p="5" overflow="auto">
      <Flex align="center" gap="3">
        <PiBroadcastFill size={20} />
        <Heading size="5">Servers on your network</Heading>

        <Tooltip content="Look again">
          <IconButton
            ml="auto"
            variant="soft"
            color="gray"
            aria-label="Look again"
            onClick={() => {
              setSearchExpired(false);
              setRowErrors({});
              rescan();
              window.setTimeout(() => setSearchExpired(true), EMPTY_AFTER_MS);
            }}
          >
            <PiArrowsClockwiseBold size={14} />
          </IconButton>
        </Tooltip>
      </Flex>

      <Text size="2" color="gray">
        Gryt servers announce themselves on the local network. Anything running
        on the same Wi-Fi or LAN turns up here on its own — no invite needed for
        the ones that are open to it.
      </Text>

      <Separator size="4" />

      {lanServers.length === 0 && !searchExpired && (
        <Flex align="center" gap="2">
          <Spinner size="1" />
          <Text size="2" color="gray">
            Searching&hellip;
          </Text>
        </Flex>
      )}

      {lanServers.length === 0 && searchExpired && (
        <Flex direction="column" gap="2" align="start">
          <Text size="2" color="gray">
            No servers found on your network.
          </Text>
          <Text size="1" color="gray">
            Still looking — one will appear here as soon as it starts. If you
            have an invite link, add it directly instead.
          </Text>
          <Button
            mt="2"
            variant="soft"
            color="gray"
            onClick={() => setShowAddServer(true)}
          >
            Add a server
          </Button>
        </Flex>
      )}

      <Flex direction="column" gap="2">
        {lanServers.map((server) => {
          const key = lanServerKey(server);
          const addr = lanServerAddr(server);
          const host = normalizeHost(addr);

          const existingByHost = !!servers[host];
          const existingById =
            !!server.serverId &&
            Object.values(servers).some((s) => s.serverId === server.serverId);
          const isMember = existingByHost || existingById;

          const error = rowErrors[key];
          const isConnectingThis = connecting === key;

          return (
            <Card key={key} size="1">
              <Flex direction="column" gap="2">
                <Flex align="center" gap="3">
                  {/*
                    Streamed from the server's own /icon endpoint. Most servers
                    have never uploaded one and return 404, so the fallback is
                    the common case rather than the exception.
                  */}
                  <Avatar
                    size="3"
                    radius="medium"
                    src={`${getServerHttpBase(host)}/icon`}
                    fallback={<GeneratedServerIcon host={host} />}
                  />

                  <Flex direction="column" style={{ minWidth: 0 }}>
                    <Text size="2" weight="bold" truncate>
                      {server.name}
                    </Text>
                    {/*
                      Address only. The version is deliberately not shown:
                      surfacing it makes it trivial to scan a network for hosts
                      on a build with a known vulnerability. It is still in the
                      mDNS TXT record and in /info, so this is not a fix for
                      that — see GRYT-42.
                    */}
                    <Text size="1" color="gray" truncate>
                      {addr}
                    </Text>
                  </Flex>

                  <Flex ml="auto" align="center" gap="2">
                    {isMember ? (
                      <>
                        <Badge size="1" variant="soft" color="green">
                          Joined
                        </Badge>
                        <Button
                          size="1"
                          variant="soft"
                          color="gray"
                          onClick={() => switchToServer(host)}
                        >
                          Open
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="1"
                        disabled={busy}
                        loading={isConnectingThis}
                        onClick={() => {
                          void handleJoin(server);
                        }}
                      >
                        Join
                      </Button>
                    )}
                  </Flex>
                </Flex>

                {error && (
                  <Callout.Root color="red" size="1" role="alert">
                    <Callout.Icon>
                      <PiWarningFill size={14} />
                    </Callout.Icon>
                    <Callout.Text>
                      {error}
                      {/* An invite cannot be typed here, and saying so without
                          offering the field that takes one is a dead end. */}
                      {error.toLowerCase().includes("invite") && (
                        <>
                          {" "}
                          <Button
                            size="1"
                            variant="ghost"
                            onClick={() => setShowAddServer(true)}
                          >
                            Use an invite
                          </Button>
                        </>
                      )}
                    </Callout.Text>
                  </Callout.Root>
                )}
              </Flex>
            </Card>
          );
        })}
      </Flex>
    </Flex>
  );
}
