import {
  Avatar,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Dialog,
  Flex,
  IconButton,
  Separator,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MdClose,
  MdInfoOutline,
  MdRadar,
  MdWarning,
  MdWifi,
} from "react-icons/md";

import {
  getServerAccessToken,
  getServerHttpBase,
  normalizeCode,
  normalizeHost,
  setServerAccessToken,
  setServerRefreshToken,
} from "@/common";
import { joinServerOnce } from "@/socket";

import { SkeletonBase } from "../../../socket/src/components/skeletons";
import { useServerManagement } from "../../../socket/src/hooks/useServerManagement";
import { useEmbeddedServer } from "../hooks/useEmbeddedServer";
import { useLanDiscovery } from "../hooks/useLanDiscovery";
import { useSettings } from "../hooks/useSettings";
import { CreateServerPanel } from "./createServer";

export type FetchInfo = {
  serverId?: string;
  name: string;
  description?: string;
  members: string;
  lanOpen?: boolean;
};

interface AddNewServerProps {
  showAddServer: boolean;
  setShowAddServer: (show: boolean) => void;
}

/**
 * How long the modal looks before admitting it has found nothing.
 *
 * Discovery never stops — this only decides when to stop saying "searching".
 * Servers that appear later still show up, replacing the empty state.
 */
const LAN_EMPTY_AFTER_MS = 4000;

export function AddNewServer({
  showAddServer,
  setShowAddServer,
}: AddNewServerProps) {
  const { addServer, servers, switchToServer } = useServerManagement();
  const { nickname } = useSettings();
  const { lanServers, isElectron, rescan } = useLanDiscovery();
  const { isAvailable: embeddedServerAvailable } = useEmbeddedServer();

  const [serverHost, setServerHost] = useState("");
  const [serverInfo, setServerInfo] = useState<FetchInfo | null>(null);
  const [hasError, setHasError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  // Drives the switch from "searching" to "found nothing". Reset each time the
  // modal opens, so reopening looks again rather than showing a stale verdict.
  const [lanSearchExpired, setLanSearchExpired] = useState(false);
  // Set when Connect is pressed on a discovered server. Joining needs
  // serverInfo, which arrives asynchronously, so the join is deferred until the
  // fetch lands rather than fired blindly.
  const autoJoinRef = useRef(false);
  const [isJoining, setIsJoining] = useState(false);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [serverPrivate, setServerPrivate] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const normalizedServerHost = useMemo(
    () => normalizeHost(serverHost),
    [serverHost]
  );

  const findExistingServerById = useCallback(
    (serverId?: string) => {
      if (!serverId) return null;

      return (
        Object.entries(servers).find(
          ([, server]) => !!server.serverId && server.serverId === serverId
        ) ?? null
      );
    },
    [servers]
  );

  const alreadyMemberByHost = useMemo(
    () => normalizedServerHost.length > 0 && !!servers[normalizedServerHost],
    [normalizedServerHost, servers]
  );

  const existingServerById = useMemo(
    () => findExistingServerById(serverInfo?.serverId),
    [findExistingServerById, serverInfo?.serverId]
  );

  const alreadyMemberByServerId = !!existingServerById;
  const alreadyMember = alreadyMemberByHost || alreadyMemberByServerId;

  const isLanDiscovered = useMemo(() => {
    if (!serverHost) return false;
    const nh = normalizeHost(serverHost);
    return lanServers.some((s) => {
      const addr = s.port === 443 ? s.host : `${s.host}:${s.port}`;
      return normalizeHost(addr) === nh;
    });
  }, [serverHost, lanServers]);

  function closeDialog() {
    if (isSearching || isJoining) return;

    setServerInfo(null);
    setHasError("");
    setIsSearching(false);
    abortRef.current?.abort();
    abortRef.current = null;
    setIsJoining(false);
    setInviteRequired(false);
    setInviteCode("");
    setJoinError("");
    setServerPrivate(false);
    setShowAddServer(false);
  }

  async function joinServer() {
    if (!serverInfo && !serverPrivate) return;

    const normalizedHost = normalizeHost(serverHost);
    if (!normalizedHost) return;

    const existingByHost = servers[normalizedHost];
    if (existingByHost) {
      setJoinError("You are already a member of this server.");
      switchToServer(existingByHost.host);
      return;
    }

    if (serverInfo?.serverId) {
      const existingById = findExistingServerById(serverInfo.serverId);
      if (existingById) {
        const [existingHost] = existingById;
        setJoinError("You are already connected to this server.");
        switchToServer(existingHost);
        return;
      }
    }

    const lanBypass = !!(isLanDiscovered && serverInfo?.lanOpen);
    const code = inviteRequired && !lanBypass ? normalizeCode(inviteCode) : "";

    if (inviteRequired && !lanBypass && code.length === 0) {
      setJoinError("Invite code required to join this server.");
      return;
    }

    setIsJoining(true);
    setJoinError("");

    const result = await joinServerOnce({
      host: normalizedHost,
      nickname,
      inviteCode: code.length > 0 ? code : undefined,
    });

    if (!result.ok) {
      if (result.error.error === "invite_required") {
        setInviteRequired(true);
        setJoinError(
          result.error.message ||
            "This server is invite-only. Paste an invite code to join."
        );
      } else if (result.error.error === "invalid_invite") {
        setInviteRequired(true);
        setJoinError(result.error.message || "Invalid invite code.");
      } else if (
        result.error.error === "invite_rate_limited" ||
        result.error.error === "rate_limited"
      ) {
        setJoinError(
          result.error.message ||
            "Too many attempts. Please wait and try again."
        );
      } else if (result.error.error === "connect_error") {
        setJoinError(
          result.error.message ||
            "Could not connect to the server. Check the address and your network."
        );
      } else if (result.error.error === "timeout") {
        setJoinError(
          result.error.message ||
            "Connection timed out. The server may be down or unreachable."
        );
      } else {
        setJoinError(
          result.error.message || `Failed to join server: ${result.error.error}`
        );
      }

      setIsJoining(false);
      return;
    }

    setServerAccessToken(normalizedHost, result.joinInfo.accessToken);
    if (result.joinInfo.refreshToken) {
      setServerRefreshToken(normalizedHost, result.joinInfo.refreshToken);
    }

    addServer(
      {
        name: serverInfo?.name || normalizedHost,
        host: normalizedHost,
        serverId: serverInfo?.serverId,
      },
      true
    );

    setIsJoining(false);
    closeDialog();
    setServerHost("");
  }

  useEffect(() => {
    setServerInfo(null);
    setHasError("");
    setInviteRequired(false);
    setInviteCode("");
    setJoinError("");
    setServerPrivate(false);
  }, [serverHost]);

  useEffect(() => {
    setJoinError("");
  }, [inviteCode]);

  // Completes the Connect action once the fetch has landed. If the server turns
  // out to need an invite, joinServer surfaces that and the card is already on
  // screen for the code to be entered — so the fallback is the old behaviour
  // rather than a dead end.
  useEffect(() => {
    if (!autoJoinRef.current) return;
    if (isSearching) return;

    if (hasError) {
      autoJoinRef.current = false;
      return;
    }

    if (!serverInfo && !serverPrivate) return;

    autoJoinRef.current = false;
    void joinServer();
    // joinServer is recreated each render and depends on this same state;
    // keying off the fetch result is what makes this fire exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverInfo, serverPrivate, hasError, isSearching]);

  // Restart the "searching" window each time the modal opens. Discovery itself
  // runs continuously in the background; this only controls how long the modal
  // claims to be looking before it admits it has found nothing.
  useEffect(() => {
    if (!showAddServer) return;

    // Opening the modal starts a fresh scan rather than showing whatever was
    // found at launch. Discovery announces each server once, so without this
    // the list is only ever as current as the moment the app started.
    rescan();

    setLanSearchExpired(false);
    const timer = window.setTimeout(
      () => setLanSearchExpired(true),
      LAN_EMPTY_AFTER_MS,
    );

    return () => window.clearTimeout(timer);
  }, [showAddServer, rescan]);

  function getServerInfo(overrideHost?: string) {
    const normalizedHost = overrideHost || normalizeHost(serverHost);
    if (!normalizedHost) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    setHasError("");
    setServerInfo(null);
    setServerPrivate(false);
    setInviteRequired(false);
    setInviteCode("");
    setJoinError("");

    const base = getServerHttpBase(normalizedHost);
    const headers: Record<string, string> = {};
    const storedToken = getServerAccessToken(normalizedHost);
    if (storedToken) headers.Authorization = `Bearer ${storedToken}`;

    fetch(`${base}/info`, { signal: controller.signal, headers })
      .then((res) => {
        if (res.status === 404) {
          setServerPrivate(true);
          setServerHost(normalizedHost);
          return;
        }
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        return res.json() as Promise<FetchInfo>;
      })
      .then((info) => {
        if (!info) return;

        setServerInfo(info);
        setServerHost(normalizedHost);

        if (info.serverId) {
          const existingById = findExistingServerById(info.serverId);
          if (existingById) {
            setJoinError("You are already connected to this server.");
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : "Server is not responding";
        setHasError(message);
      })
      .finally(() => {
        setIsSearching(false);
      });
  }

  const handleEnterKey = (event: { key: string }) => {
    if (event.key === "Enter") {
      if (isSearching || isJoining) return;
      getServerInfo();
    }
  };

  return (
    <Dialog.Root open={showAddServer} onOpenChange={closeDialog}>
      <Dialog.Content maxWidth="600px" style={{ overflow: "hidden" }}>
        <Dialog.Close
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
          }}
        >
          <IconButton variant="soft" color="gray">
            <MdClose size={16} />
          </IconButton>
        </Dialog.Close>

        <Flex direction="column" gap="2">
          <Dialog.Title as="h1" weight="bold" size="6">
            New server
          </Dialog.Title>

          <Dialog.Description size="2" mb="4">
            To add a new server, enter the server&apos;s address below to fetch
            its information.
          </Dialog.Description>

          <Flex direction="column" gap="4">
            {embeddedServerAvailable && (
              <>
                <CreateServerPanel
                  onServerReady={(serverUrl, serverName) => {
                    const host = normalizeHost(
                      serverUrl.replace(/^https?:\/\//, "")
                    );

                    if (servers[host]) {
                      switchToServer(host);
                      closeDialog();
                      return;
                    }

                    addServer(
                      {
                        name: serverName,
                        host,
                      },
                      true
                    );
                    closeDialog();
                  }}
                />
                <Separator size="4" />
              </>
            )}

            {isElectron && (
              <>
                <Flex direction="column" gap="2">
                  <Flex align="center" gap="2">
                    <MdRadar size={16} />
                    <Text size="2" weight="bold">
                      Local servers
                    </Text>
                    {lanServers.length > 0 && (
                      <Badge color="green" size="1" variant="soft">
                        {lanServers.length}
                      </Badge>
                    )}
                  </Flex>

                  {lanServers.length === 0 && !lanSearchExpired && (
                    <Flex align="center" gap="2" py="1">
                      <Spinner size="1" />
                      <Text size="2" color="gray">
                        Searching for servers on your network&hellip;
                      </Text>
                    </Flex>
                  )}

                  {lanServers.length === 0 && lanSearchExpired && (
                    <Flex direction="column" gap="1" py="1">
                      <Text size="2" color="gray">
                        No servers found on your network.
                      </Text>
                      <Text size="1" color="gray">
                        Still looking &mdash; one will appear here as soon as it
                        starts. You can also enter an address below.
                      </Text>
                    </Flex>
                  )}

                  <Flex direction="column" gap="2">
                    {lanServers.map((s) => {
                      const addr =
                        s.port === 443 ? s.host : `${s.host}:${s.port}`;
                      const normalizedAddr = normalizeHost(addr);

                      const existingByHost = !!servers[normalizedAddr];
                      const existingById = !!findExistingServerById(s.serverId);
                      const isMember = existingByHost || existingById;

                      return (
                        <Card key={`${s.host}:${s.port}`} size="1">
                          <Flex align="center" gap="3">
                            {/*
                              Streamed from the server's own /icon endpoint.
                              Most servers have never uploaded one and return
                              404, so the fallback initial is the common case
                              rather than the exception.
                            */}
                            <Avatar
                              size="2"
                              radius="medium"
                              src={`${getServerHttpBase(normalizedAddr)}/icon`}
                              fallback={s.name.trim().charAt(0).toUpperCase() || "?"}
                            />

                            <Flex direction="column" style={{ minWidth: 0 }}>
                              <Text size="2" weight="medium" truncate>
                                {s.name}
                              </Text>
                              {/*
                                Address only. The version is deliberately not
                                shown: surfacing it makes it trivial to scan a
                                network for hosts on a build with a known
                                vulnerability. It is still in the mDNS TXT
                                record and in /info, so this is not a fix for
                                that — see GRYT-42.
                              */}
                              <Text size="1" color="gray" truncate>
                                {addr}
                              </Text>
                            </Flex>

                            <Button
                              size="1"
                              variant="soft"
                              ml="auto"
                              disabled={isMember || isSearching || isJoining}
                              onClick={() => {
                                // Connect should connect. Previously this only
                                // filled the field and showed the info card,
                                // leaving a second click to actually join.
                                autoJoinRef.current = true;
                                setServerHost(normalizedAddr);
                                queueMicrotask(() =>
                                  getServerInfo(normalizedAddr)
                                );
                              }}
                            >
                              {isMember ? "Joined" : "Connect"}
                            </Button>
                          </Flex>
                        </Card>
                      );
                    })}
                  </Flex>
                </Flex>
                <Separator size="4" />
              </>
            )}

            <Flex gap="2" align="center">
              <TextField.Root
                type="url"
                disabled={isSearching || isJoining}
                onKeyDown={handleEnterKey}
                radius="full"
                placeholder="gryt.chat"
                value={serverHost}
                onChange={(e) => setServerHost(normalizeHost(e.target.value))}
                style={{ width: "100%" }}
              >
                <TextField.Slot>wss://</TextField.Slot>
              </TextField.Root>

              <Button
                onClick={() => getServerInfo()}
                disabled={isSearching || isJoining || serverHost.length === 0}
              >
                {isSearching ? (
                  <SkeletonBase width="16px" height="16px" borderRadius="50%" />
                ) : (
                  <MdWifi size={16} />
                )}
                {isSearching ? "Connecting" : "Connect"}
              </Button>
            </Flex>

            <AnimatePresence>
              {alreadyMember && !serverInfo && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  <Callout.Root color="blue">
                    <Callout.Icon>
                      <MdInfoOutline size={16} />
                    </Callout.Icon>
                    <Callout.Text>
                      You are already a member of this server.
                    </Callout.Text>
                  </Callout.Root>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {hasError.length > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                >
                  <Callout.Root color="red" role="alert">
                    <Callout.Icon>
                      <MdWarning size={16} />
                    </Callout.Icon>
                    <Callout.Text>
                      Could not connect to the server. Please check the address
                      and try again.
                      <br />(
                      {hasError === "xhr poll error"
                        ? "Server is not responding"
                        : hasError}
                      )
                    </Callout.Text>
                  </Callout.Root>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {serverPrivate && !serverInfo && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  style={{
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <Callout.Root color="amber">
                    <Callout.Icon>
                      <MdInfoOutline size={16} />
                    </Callout.Icon>
                    <Callout.Text>
                      This server has public info disabled. If you are an
                      existing member or have an invite code, you can still
                      join.
                    </Callout.Text>
                  </Callout.Root>

                  <AnimatePresence>
                    {joinError.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                      >
                        <Callout.Root color="red" role="alert">
                          <Callout.Icon>
                            <MdWarning size={16} />
                          </Callout.Icon>
                          <Callout.Text>{joinError}</Callout.Text>
                        </Callout.Root>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {inviteRequired && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                      >
                        <Flex direction="column" gap="2">
                          <Text size="2" color="gray" weight="bold">
                            Invite code
                          </Text>
                          <TextField.Root
                            disabled={isJoining}
                            radius="full"
                            placeholder="Paste invite code"
                            value={inviteCode}
                            onChange={(e) =>
                              setInviteCode(normalizeCode(e.target.value))
                            }
                          />
                        </Flex>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Button
                    disabled={
                      alreadyMember ||
                      isJoining ||
                      (inviteRequired && normalizeCode(inviteCode).length === 0)
                    }
                    onClick={() => {
                      void joinServer();
                    }}
                  >
                    {alreadyMember ? (
                      "You are already a member"
                    ) : isJoining ? (
                      <>
                        <SkeletonBase
                          width="16px"
                          height="16px"
                          borderRadius="50%"
                        />{" "}
                        Joining…
                      </>
                    ) : inviteRequired ? (
                      <>Join with code</>
                    ) : (
                      <>Join server</>
                    )}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {serverInfo && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  style={{
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  <Box maxWidth="100%">
                    <Card>
                      <Flex direction="column" gap="3" align="center">
                        <Avatar
                          size="8"
                          src={`${getServerHttpBase(serverHost)}/icon`}
                          radius="full"
                          fallback={serverInfo.name[0]}
                        />
                        <Flex gap="1" direction="column" align="center">
                          <Text size="4" weight="bold">
                            {serverInfo.name}
                          </Text>
                          {serverInfo.description ? (
                            <Text
                              size="2"
                              color="gray"
                              style={{ textAlign: "center" }}
                            >
                              {serverInfo.description}
                            </Text>
                          ) : null}
                          <Text size="2" color="gray">
                            Members: {serverInfo.members}
                          </Text>
                        </Flex>
                      </Flex>
                    </Card>
                  </Box>

                  <AnimatePresence>
                    {joinError.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                      >
                        <Callout.Root color="red" role="alert">
                          <Callout.Icon>
                            <MdWarning size={16} />
                          </Callout.Icon>
                          <Callout.Text>{joinError}</Callout.Text>
                        </Callout.Root>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {inviteRequired &&
                      !(isLanDiscovered && serverInfo.lanOpen) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                        >
                          <Flex direction="column" gap="2">
                            <Text size="2" color="gray" weight="bold">
                              Invite code
                            </Text>
                            <TextField.Root
                              disabled={isJoining}
                              radius="full"
                              placeholder="Paste invite code"
                              value={inviteCode}
                              onChange={(e) =>
                                setInviteCode(normalizeCode(e.target.value))
                              }
                            />
                          </Flex>
                        </motion.div>
                      )}
                  </AnimatePresence>

                  <Button
                    disabled={
                      alreadyMember ||
                      isJoining ||
                      (inviteRequired &&
                        !(isLanDiscovered && serverInfo.lanOpen) &&
                        normalizeCode(inviteCode).length === 0)
                    }
                    onClick={() => {
                      void joinServer();
                    }}
                  >
                    {alreadyMember ? (
                      "You are already a member"
                    ) : isJoining ? (
                      <>
                        <SkeletonBase
                          width="16px"
                          height="16px"
                          borderRadius="50%"
                        />{" "}
                        Joining…
                      </>
                    ) : inviteRequired &&
                      !(isLanDiscovered && serverInfo.lanOpen) ? (
                      <>Join with code</>
                    ) : (
                      <>Join {serverInfo.name}</>
                    )}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
