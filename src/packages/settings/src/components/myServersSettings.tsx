import { Accordion } from "@gryt/ui";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
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
    isBusy,
    dismissError,
  } = useEmbeddedServer();
  const { setShowSettings } = useSettings();
  const { setShowAddServer } = useServerManagement();

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
        <Text size="2" color="gray">
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
        <Text size="1" color="gray">
          Servers Gryt runs on this machine. They are yours: each one holds its
          own messages and members, and is only reachable while it is running
          and this machine is on.
        </Text>

        {servers.length === 0 ? (
          <Flex direction="column" gap="3" align="start">
            <Text size="2" color="gray">
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
                onDismissError={() => {
                  void dismissError(server.id);
                }}
              />
            ))}

            <Flex width="fit-content">
              <Button variant="soft" color="gray" onClick={hostAServer}>
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
  onDismissError,
}: {
  server: EmbeddedServerState;
  lanIp: string;
  autoStart: boolean;
  busy: boolean;
  onAutoStart: (enabled: boolean) => void;
  onStart: () => void;
  onStop: () => void;
  onDismissError: () => void;
}) {
  const { servers: joinedServers, addServer, switchToServer } =
    useServerManagement();
  const { setShowSettings } = useSettings();

  /** Which accordion sections are open. Logs are not fetched until theirs is. */
  const [logsOpen, setLogsOpen] = useState<string[]>([]);

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
          <Avatar
            size="3"
            radius="full"
            src={undefined}
            fallback={<GeneratedServerIcon seed={name} />}
          />

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
              <Text size="1" color="gray">
                <Code size="1" variant="ghost">
                  127.0.0.1:{port}
                </Code>
              </Text>
              {server.config?.lanDiscoverable && (
                <Text size="1" color="gray">
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
                variant="soft"
                color="red"
                onClick={onStop}
                disabled={busy}
              >
                {busy ? <Spinner size="1" /> : <PiStopFill size={16} />}
                Stop
              </Button>
            ) : (
              <Button
                variant="soft"
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

        <Flex asChild gap="2" align="center">
          <label>
            <Checkbox
              checked={autoStart}
              onCheckedChange={(c) => onAutoStart(c === true)}
            />
            <Text size="1" color="gray">
              Start automatically with app
            </Text>
          </label>
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
            <Callout.Root color="red" role="alert">
              <Callout.Icon>
                <PiWarningFill size={16} />
              </Callout.Icon>
              <Callout.Text>{server.error}</Callout.Text>
            </Callout.Root>
            <Flex justify="end">
              <Button size="1" variant="ghost" color="gray" onClick={onDismissError}>
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
