import {
  Avatar,
  Box,
  Button,
  Callout,
  Card,
  Dialog,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MdClose, MdInfoOutline, MdWarning, MdWifi } from "react-icons/md";

import {
  getServerHttpBase,
  getValidIdentityToken,
  normalizeCode,
  normalizeHost,
  setServerAccessToken,
  setServerRefreshToken,
} from "@/common";
import { joinServerOnce } from "@/socket";

import { SkeletonBase } from "../../../socket/src/components/skeletons";
import { useServerManagement } from "../../../socket/src/hooks/useServerManagement";
import { useSettings } from "../hooks/useSettings";

export type FetchInfo = {
  name: string;
  description?: string;
  members: string;
};

interface AddNewServerProps {
  showAddServer: boolean;
  setShowAddServer: (show: boolean) => void;
}

export function AddNewServer({ showAddServer, setShowAddServer }: AddNewServerProps) {
  const { addServer, servers } = useServerManagement();
  const { nickname } = useSettings();

  const [serverHost, setServerHost] = useState("");
  const [serverInfo, setServerInfo] = useState<FetchInfo | null>(null);
  const [hasError, setHasError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [inviteRequired, setInviteRequired] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joinError, setJoinError] = useState("");

  const alreadyMember = useMemo(
    () => serverHost.length > 0 && !!servers[normalizeHost(serverHost)],
    [serverHost, servers],
  );

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
      setShowAddServer(false);
    }
  }

  async function joinServer() {
    if (!serverInfo) return;
    if (servers[serverHost]) return;

    const normalizedHost = normalizeHost(serverHost);
    if (!normalizedHost) return;

    const code = inviteRequired ? normalizeCode(inviteCode) : "";
    if (inviteRequired && code.length === 0) {
      setJoinError("Invite code required to join this server.");
      return;
    }

    setIsJoining(true);
    setJoinError("");

    const identityToken = await getValidIdentityToken().catch(() => undefined);
    const result = await joinServerOnce({
      host: normalizedHost,
      nickname,
      identityToken,
      inviteCode: code.length > 0 ? code : undefined,
    });

    if (!result.ok) {
      if (result.error.error === "invite_required") {
        setInviteRequired(true);
        setJoinError(result.error.message || "This server is invite-only. Paste an invite code to join.");
      } else if (result.error.error === "invalid_invite") {
        setInviteRequired(true);
        setJoinError(result.error.message || "Invalid invite code.");
      } else if (result.error.error === "invite_rate_limited" || result.error.error === "rate_limited") {
        setJoinError(result.error.message || "Too many attempts. Please wait and try again.");
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
        name: serverInfo.name,
        host: normalizedHost,
      },
      true
    ); // Auto-focus the new server

    closeDialog();
    setServerHost("");
  }

  useEffect(() => {
    setHasError("");
    setInviteRequired(false);
    setInviteCode("");
    setJoinError("");
  }, [serverHost]);

  useEffect(() => {
    setJoinError("");
  }, [inviteCode]);

  function getServerInfo() {
    const normalizedHost = normalizeHost(serverHost);
    if (!normalizedHost) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsSearching(true);
    setHasError("");
    setServerInfo(null);
    setInviteRequired(false);
    setInviteCode("");
    setJoinError("");

    const base = getServerHttpBase(normalizedHost);
    fetch(`${base}/info`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        return res.json() as Promise<FetchInfo>;
      })
      .then((info) => {
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
                onClick={getServerInfo}
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
