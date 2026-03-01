import {
  AlertDialog,
  Avatar,
  Box,
  Button,
  Callout,
  Flex,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import { useEffect, useState } from "react";
import { MdWarning, MdWifi } from "react-icons/md";

import {
  getServerHttpBase,
  normalizeHost,
  setServerAccessToken,
  setServerRefreshToken,
} from "@/common";
import { type FetchInfo } from "@/settings/src/components/addServer";
import { useServerManagement } from "@/socket";
import { joinServerOnce } from "@/socket";
import { SkeletonBase } from "@/socket/src/components/skeletons";

import { type LanServer } from "../lib/electron";

interface LanServerItemProps {
  server: LanServer;
}

export function LanServerItem({ server }: LanServerItemProps) {
  const { addServer, dismissLanServer, servers } = useServerManagement();
  const [open, setOpen] = useState(false);
  const [serverInfo, setServerInfo] = useState<FetchInfo | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState("");

  const addr = server.port === 443 ? server.host : `${server.host}:${server.port}`;
  const normalizedHost = normalizeHost(addr);
  const key = `${server.host}:${server.port}`;
  const httpBase = getServerHttpBase(normalizedHost);

  useEffect(() => {
    if (!open) {
      setServerInfo(null);
      setFetchError("");
      setJoinError("");
      return;
    }

    const controller = new AbortController();
    fetch(`${httpBase}/info`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Server responded with ${res.status}`);
        return res.json() as Promise<FetchInfo>;
      })
      .then(setServerInfo)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFetchError(err instanceof Error ? err.message : "Could not reach server");
      });

    return () => controller.abort();
  }, [open, httpBase]);

  async function handleJoin() {
    if (!serverInfo || servers[normalizedHost]) return;
    setIsJoining(true);
    setJoinError("");

    const result = await joinServerOnce({ host: normalizedHost });

    if (!result.ok) {
      setJoinError(result.error.message || `Failed to join: ${result.error.error}`);
      setIsJoining(false);
      return;
    }

    setServerAccessToken(normalizedHost, result.joinInfo.accessToken);
    if (result.joinInfo.refreshToken) {
      setServerRefreshToken(normalizedHost, result.joinInfo.refreshToken);
    }

    addServer({ name: serverInfo.name, host: normalizedHost }, true);
    setOpen(false);
    setIsJoining(false);
  }

  function handleDismiss() {
    dismissLanServer(key);
    setOpen(false);
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={(v) => { if (!isJoining) setOpen(v); }}>
      <Tooltip content={`${server.name} (LAN)`} delayDuration={100} side="right">
        <Box position="relative" style={{ cursor: "pointer" }} onClick={() => setOpen(true)}>
          <Avatar
            size="2"
            color="gray"
            fallback={server.name[0]}
            src={`${httpBase}/icon`}
            style={{
              opacity: 0.4,
              border: "2px dashed var(--gray-7)",
              borderRadius: "var(--radius-2)",
            }}
          />
          <Box
            position="absolute"
            bottom="-3px"
            right="-3px"
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              backgroundColor: "var(--green-9)",
              border: "2px solid var(--color-background)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1,
            }}
          >
            <MdWifi size={8} color="white" />
          </Box>
        </Box>
      </Tooltip>

      <AlertDialog.Content maxWidth="400px">
        <AlertDialog.Title>Server found on your network</AlertDialog.Title>

        {!serverInfo && !fetchError && (
          <Flex align="center" gap="2" py="4">
            <SkeletonBase width="16px" height="16px" borderRadius="50%" />
            <Text size="2" color="gray">Connecting to {server.name}...</Text>
          </Flex>
        )}

        {fetchError && (
          <Callout.Root color="red" my="2">
            <Callout.Icon><MdWarning size={16} /></Callout.Icon>
            <Callout.Text>Could not reach server: {fetchError}</Callout.Text>
          </Callout.Root>
        )}

        {serverInfo && (
          <Flex direction="column" gap="3" my="2">
            <Flex align="center" gap="3">
              <Avatar
                size="5"
                src={`${httpBase}/icon`}
                fallback={serverInfo.name[0]}
                radius="full"
              />
              <Flex direction="column" gap="1">
                <Text size="3" weight="bold">{serverInfo.name}</Text>
                {serverInfo.description && (
                  <Text size="2" color="gray">{serverInfo.description}</Text>
                )}
                <Text size="1" color="gray">{serverInfo.members} members</Text>
              </Flex>
            </Flex>

            {joinError && (
              <Callout.Root color="red">
                <Callout.Icon><MdWarning size={16} /></Callout.Icon>
                <Callout.Text>{joinError}</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
        )}

        <Flex gap="3" mt="4" justify="end">
          <Button variant="soft" color="gray" onClick={handleDismiss} disabled={isJoining}>
            Dismiss
          </Button>
          <Button
            variant="solid"
            onClick={() => { void handleJoin(); }}
            disabled={!serverInfo || isJoining || !!servers[normalizedHost]}
          >
            {isJoining ? (
              <><SkeletonBase width="16px" height="16px" borderRadius="50%" /> Joining...</>
            ) : (
              "Join"
            )}
          </Button>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
