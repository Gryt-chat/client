import { Accordion, Avatar, Checkbox, TextField } from "@gryt/ui";
import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Card,
  Code,
  Flex,
  Heading,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { useState } from "react";
import {
  PiHardDrivesFill,
  PiPlayFill,
  PiPlusBold,
  PiStopFill,
  PiTrashFill,
  PiWarningFill,
  PiX,
} from "react-icons/pi";

import { GeneratedServerIcon, normalizeHost } from "@/common";

import type { EmbeddedServerState } from "../../../../lib/electron";
import { useServerManagement } from "../../../socket/src/hooks/useServerManagement";
import { useEmbeddedServer } from "../hooks/useEmbeddedServer";
import { useSettings } from "../hooks/useSettings";
import { EmbeddedServerLogs } from "./embeddedServerLogs";
import { SettingsContainer } from "./settingsComponents";

/**
 * The servers you run, as opposed to the ones you have joined.
 *
 * This was the other half of the add-server dialog: a running-server card with
 * start, stop, logs and autostart, shown or not depending on state, under a
 * heading that said "Add a server". Managing something you already run is a
 * different job from adding one, and it belongs where you go to change things
 * rather than where you go to get somewhere.
 *
 * A list of however many you host. They share one SFU — it routes on the server
 * id every message carries — so the second one costs a server process and an
 * image worker rather than a whole stack.
 */
export function MyServersSettings() {
  const {
    isAvailable,
    servers,
    lanIp,
    autoStart,
    setAutoStart,
    startServer,
    stopServer,
    deleteServer,
    isBusy,
    dismissError,
  } = useEmbeddedServer();
  const { setShowSettings } = useSettings();
  const { setShowAddServer, servers: joinedServers, removeServer } =
    useServerManagement();

  function hostAServer() {
    setShowSettings(false);
    setShowAddServer(true);
  }

  if (!isAvailable) {
    return (
      <SettingsContainer>
        <Heading as="h2" size="4">
          My servers
        </Heading>
        <Text size="2">
          This build does not have a server bundled with it, so there is nothing
          to run here. Joining somebody else&rsquo;s works as normal.
        </Text>
      </SettingsContainer>
    );
  }

  return (
    <SettingsContainer>
      <Heading as="h2" size="4">
        My servers
      </Heading>

      <Flex direction="column" gap="3">
        <Text size="1">
          Servers Gryt runs on this machine. They are yours: each one holds its
          own messages and members, and is only reachable while it is running
          and this machine is on.
        </Text>

        {servers.length === 0 ? (
          <Flex direction="column" gap="3" align="start">
            <Text size="2">
              You are not running one yet.
            </Text>
            <Button onClick={hostAServer}>
              <PiHardDrivesFill size={16} />
              Host a server
            </Button>
          </Flex>
        ) : (
          <>
            {servers.map((server) => (
              <HostedServerCard
                key={server.id}
                server={server}
                lanIp={lanIp}
                autoStart={autoStart[server.id] ?? false}
                busy={isBusy(server.id)}
                onAutoStart={(enabled) => setAutoStart(server.id, enabled)}
                onStart={() => {
                  void startServer(server.id);
                }}
                onStop={() => {
                  void stopServer(server.id);
                }}
                onDelete={() => {
                  // The rail entry goes with it. Left behind it points at an
                  // address nothing answers on, and looks like a server that
                  // is merely offline rather than one that no longer exists.
                  const host = server.serverUrl
                    ? normalizeHost(server.serverUrl)
                    : "";
                  if (host && joinedServers[host]) removeServer(host);
                  void deleteServer(server.id);
                }}
                onDismissError={() => {
                  void dismissError(server.id);
                }}
              />
            ))}

            <Flex width="fit-content">
              <Button onClick={hostAServer}>
                <PiPlusBold size={14} />
                Host another server
              </Button>
            </Flex>
          </>
        )}
      </Flex>
    </SettingsContainer>
  );
}

/**
 * Every control is passed in rather than pulled from useEmbeddedServer here.
 * The hook opens an IPC subscription and fetches the server list when it
 * mounts, so calling it per card would do both once per server on top of the
 * parent's — the same work, N+1 times, for a list that is already in scope.
 */
function HostedServerCard({
  server,
  lanIp,
  autoStart,
  busy,
  onAutoStart,
  onStart,
  onStop,
  onDelete,
  onDismissError,
}: {
  server: EmbeddedServerState;
  lanIp: string;
  autoStart: boolean;
  busy: boolean;
  onAutoStart: (enabled: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onDelete: () => void;
  onDismissError: () => void;
}) {
  const { servers: joinedServers, addServer, switchToServer } =
    useServerManagement();
  const { setShowSettings } = useSettings();

  /** Which accordion sections are open. Logs are not fetched until theirs is. */
  const [logsOpen, setLogsOpen] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Typed back before Delete works. This destroys a database. */
  const [typedName, setTypedName] = useState("");

  const isRunning = server.status === "running";
  const isStarting = server.status === "starting";
  const hasError = server.status === "error";
  const name = server.config?.serverName ?? "My Server";
  const port = server.config?.serverPort;
  const host = server.serverUrl ? normalizeHost(server.serverUrl) : "";

  /** Put this server in the rail and go look at it. */
  function openServer() {
    if (!host) return;

    if (joinedServers[host]) switchToServer(host);
    else addServer({ name, host }, true);

    setShowSettings(false);
  }

  return (
    <Card size="2">
      <Flex direction="column" gap="3">
        <Flex align="center" gap="3">
          <Avatar fallback={<GeneratedServerIcon seed={name} />} />

          <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
            <Flex align="center" gap="2">
              <Text size="2" weight="bold" truncate>
                {name}
              </Text>
              <Badge
                size="1"
                color={isRunning ? "green" : isStarting ? "amber" : "gray"}
              >
                {isRunning ? "Running" : isStarting ? "Starting…" : "Stopped"}
              </Badge>
            </Flex>

            {/* Both addresses, because they answer different questions: the
                first is where this machine reaches it, the second is what you
                give somebody else. */}
            <Flex direction="column" gap="1">
              <Text size="1">
                <Code size="1" variant="ghost">
                  127.0.0.1:{port}
                </Code>
              </Text>
              {server.config?.lanDiscoverable && (
                <Text size="1">
                  On your network{" "}
                  <Code size="1" variant="ghost">
                    {lanIp}:{port}
                  </Code>
                </Text>
              )}
            </Flex>
          </Flex>

          <Flex ml="auto" gap="2" align="center">
            {isRunning || isStarting ? (
              <Button
                onClick={onStop}
                disabled={busy}
              >
                {busy ? <Spinner size="1" /> : <PiStopFill size={16} />}
                Stop
              </Button>
            ) : (
              <Button
                onClick={onStart}
                disabled={busy}
              >
                {busy ? <Spinner size="1" /> : <PiPlayFill size={16} />}
                Start
              </Button>
            )}

            <Button onClick={openServer} disabled={!isRunning}>
              Open
            </Button>
          </Flex>
        </Flex>

        <Flex align="center" gap="3">
          <Flex asChild gap="2" align="center">
            <label>
              <Checkbox
                checked={autoStart}
                onCheckedChange={(c) => onAutoStart(c === true)}
              />
              <Text size="1">
                Start automatically with app
              </Text>
            </label>
          </Flex>

          <AlertDialog.Root
            open={confirmDelete}
            onOpenChange={(open) => {
              setConfirmDelete(open);
              if (!open) setTypedName("");
            }}
          >
            <Button
              size="1"
              variant="ghost"
              ml="auto"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <PiTrashFill size={12} />
              Delete
            </Button>

            <AlertDialog.Content maxWidth="460px">
              <AlertDialog.Title>Delete {name}?</AlertDialog.Title>
              <AlertDialog.Description size="2">
                This deletes the server and everything on it — its messages, its
                members, its uploads and its identity key. There is no other
                copy.
              </AlertDialog.Description>

              {/* Said separately because it is the part nobody expects.
                  Everyone who joined pinned this server's identity key, so a
                  new server with the same name and port is a different server
                  to them, and they are turned away rather than let back in. */}
              <Text as="p" size="2" mt="3">
                Anybody who joined cannot rejoin a replacement, even with the
                same name and port.
              </Text>

              <Flex direction="column" gap="2" mt="4">
                <Text size="2">
                  Type <strong>{name}</strong> to confirm.
                </Text>
                <TextField
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder={name}
                  autoFocus
                />
              </Flex>

              <Flex gap="3" mt="4" justify="end">
                <AlertDialog.Cancel>
                  <Button>
                    Cancel
                  </Button>
                </AlertDialog.Cancel>
                <Button
                  variant="solid"
                  disabled={typedName.trim() !== name}
                  onClick={() => {
                    setConfirmDelete(false);
                    setTypedName("");
                    onDelete();
                  }}
                >
                  Delete for good
                </Button>
              </Flex>
            </AlertDialog.Content>
          </AlertDialog.Root>
        </Flex>

        {/* Behind an accordion, and genuinely unmounted when shut.
            EmbeddedServerLogs pulls the whole history and opens a live
            subscription the moment it mounts, so hiding it with CSS would have
            kept both running for a panel nobody had asked to see. Closed means
            not fetching. */}
        {(isRunning || isStarting) && (
          <Accordion
            value={logsOpen}
            onValueChange={(value: unknown) => setLogsOpen(value as string[])}
          >
            <Accordion.Item value="logs">
              <Accordion.Trigger>Server logs</Accordion.Trigger>
              <Accordion.Panel>
                {logsOpen.includes("logs") && (
                  <EmbeddedServerLogs serverId={server.id} />
                )}
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}

        {hasError && server.error && (
          <Flex direction="column" gap="2">
            <Callout.Root role="alert">
              <Callout.Icon>
                <PiWarningFill size={16} />
              </Callout.Icon>
              <Callout.Text>{server.error}</Callout.Text>
            </Callout.Root>
            <Flex justify="end">
              <Button size="1" variant="ghost" onClick={onDismissError}>
                <PiX size={14} />
                Dismiss
              </Button>
            </Flex>
          </Flex>
        )}
      </Flex>
    </Card>
  );
}
