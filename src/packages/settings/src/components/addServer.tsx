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
  Text,
  TextField,
} from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MdClose, MdInfoOutline, MdRadar, MdWarning, MdWifi } from "react-icons/md";

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
  name: string;
  description?: string;
  members: string;
  lanOpen?: boolean;
};

interface AddNewServerProps {
  showAddServer: boolean;
  setShowAddServer: (show: boolean) => void;
}

export function AddNewServer({ showAddServer, setShowAddServer }: AddNewServerProps) {
  const { addServer, servers } = useServerManagement();
  const { nickname } = useSettings();
  const { lanServers, isElectron } = useLanDiscovery();
  const { isAvailable: embeddedServerAvailable } = useEmbeddedServer();

  const [serverHost, setServerHost] = useState("");
  const [serverInfo, setServerInfo] = useState<FetchInfo | null>(null);
  const [hasError, setHasError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [serverPrivate, setServerPrivate] = useState(false);

  const alreadyMember = useMemo(
    () => serverHost.length > 0 && !!servers[normalizeHost(serverHost)],
    [serverHost, servers],
  );

  const isLanDiscovered = useMemo(() => {
    if (!serverHost) return false;
    const nh = normalizeHost(serverHost);
    return lanServers.some((s) => {
      const addr = s.port === 443 ? s.host : `${s.host}:${s.port}`;
      return normalizeHost(addr) === nh;
    });
  }, [serverHost, lanServers]);

  function closeDialog() {
    if (!isSearching && !isJoining) {
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
  }

  async function joinServer() {
    if (!serverInfo && !serverPrivate) return;
    if (servers[serverHost]) return;

    const normalizedHost = normalizeHost(serverHost);
    if (!normalizedHost) return;

    const lanBypass = !!(isLanDiscovered && serverInfo?.lanOpen);
    const code = (inviteRequired && !lanBypass) ? normalizeCode(inviteCode) : "";
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
      console.warn(`[AddServer] Join failed for ${normalizedHost}:`, result.error);
      if (result.error.error === "invite_required") {
        setInviteRequired(true);
        setJoinError(result.error.message || "This server is invite-only. Paste an invite code to join.");
      } else if (result.error.error === "invalid_invite") {
        setInviteRequired(true);
        setJoinError(result.error.message || "Invalid invite code.");
      } else if (result.error.error === "invite_rate_limited" || result.error.error === "rate_limited") {
        setJoinError(result.error.message || "Too many attempts. Please wait and try again.");
      } else if (result.error.error === "connect_error") {
        setJoinError(result.error.message || "Could not connect to the server. Check the address and your network.");
      } else if (result.error.error === "timeout") {
        setJoinError(result.error.message || "Connection timed out. The server may be down or unreachable.");
      } else {
        setJoinError(result.error.message || `Failed to join server: ${result.error.error}`);
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
      },
      true,
    );

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
    if (storedToken) headers["Authorization"] = `Bearer ${storedToken}`;

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
            To add a new server, enter the server's address below to fetch its
            information.
          </Dialog.Description>

          <Flex direction="column" gap="4">
            {embeddedServerAvailable && (
              <>
                <CreateServerPanel
                  onServerReady={(serverUrl, serverName) => {
                    const host = serverUrl.replace(/^https?:\/\//, "");
                    setServerHost(host);
                    addServer({ name: serverName, host: normalizeHost(host) }, true);
                    closeDialog();
                  }}
                />
                <Separator size="4" />
              </>
            )}

            {isElectron && lanServers.length > 0 && (
              <>
                <Flex direction="column" gap="2">
                  <Flex align="center" gap="2">
                    <MdRadar size={16} />
                    <Text size="2" weight="bold">
                      Local servers
                    </Text>
                    <Badge color="green" size="1" variant="soft">
                      {lanServers.length}
                    </Badge>
                  </Flex>
                  <Flex direction="column" gap="2">
                    {lanServers.map((s) => {
                      const addr = s.port === 443
                        ? s.host
                        : `${s.host}:${s.port}`;
                      const isMember = !!servers[normalizeHost(addr)];

                      return (
                        <Card key={`${s.host}:${s.port}`} size="1">
                          <Flex justify="between" align="center">
                            <Flex direction="column" gap="1">
                              <Text size="2" weight="bold">{s.name}</Text>
                              <Flex gap="2" align="center">
                                <Text size="1" color="gray">{addr}</Text>
                                {s.version && (
                                  <Badge size="1" variant="outline" color="gray">v{s.version}</Badge>
                                )}
                              </Flex>
                            </Flex>
                            <Button
                              size="1"
                              variant="soft"
                              disabled={isMember || isSearching || isJoining}
                              onClick={() => {
                                setServerHost(normalizeHost(addr));
                                queueMicrotask(() => getServerInfo(normalizeHost(addr)));
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
                onChange={(e) =>
                  setServerHost(normalizeHost(e.target.value))
                }
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
                      and try again. <br />(
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
                      This server has public info disabled. If you are an existing member or have an invite code, you can still join.
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
                            onChange={(e) => setInviteCode(normalizeCode(e.target.value))}
                          />
                        </Flex>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Button
                    disabled={
                      !!servers[serverHost] ||
                      isJoining ||
                      (inviteRequired && normalizeCode(inviteCode).length === 0)
                    }
                    onClick={() => {
                      void joinServer();
                    }}
                  >
                    {servers[serverHost] ? (
                      "You are already a member"
                    ) : isJoining ? (
                      <>
                        <SkeletonBase width="16px" height="16px" borderRadius="50%" /> Joining…
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
                            <Text size="2" color="gray" style={{ textAlign: "center" }}>
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
                    {inviteRequired && !(isLanDiscovered && serverInfo.lanOpen) && (
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
                            onChange={(e) => setInviteCode(normalizeCode(e.target.value))}
                          />
                        </Flex>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <Button
                    disabled={
                      !!servers[serverHost] ||
                      isJoining ||
                      (inviteRequired && !(isLanDiscovered && serverInfo.lanOpen) && normalizeCode(inviteCode).length === 0)
                    }
                    onClick={() => {
                      void joinServer();
                    }}
                  >
                    {servers[serverHost] ? (
                      "You are already a member"
                    ) : isJoining ? (
                      <>
                        <SkeletonBase width="16px" height="16px" borderRadius="50%" /> Joining…
                      </>
                    ) : inviteRequired && !(isLanDiscovered && serverInfo.lanOpen) ? (
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
