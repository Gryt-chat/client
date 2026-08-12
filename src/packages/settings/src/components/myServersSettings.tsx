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
  Tooltip,
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
 * Built as a list of one. Gryt hosts a single embedded server per machine
 * today — GRYT-222 is what makes a second possible — so the shape is here and
 * the second row is the only thing missing.
 */
export function MyServersSettings() {
  const {
    isAvailable,
    hasExistingServer,
    existingConfig,
    lanIp,
    state,
    loading,
    autoStart,
    setAutoStart,
    startServer,
    stopServer,
    dismissError,
  } = useEmbeddedServer();

  const { servers, addServer, switchToServer, setShowAddServer } =
    useServerManagement();
  const { setShowSettings } = useSettings();

  /** Which accordion sections are open. Logs are not fetched until theirs is. */
  const [logsOpen, setLogsOpen] = useState<string[]>([]);

  const isRunning = state.status === "running";
  const isStarting = state.status === "starting";
  const hasError = state.status === "error";
  const config = state.config ?? existingConfig;
  const name = config?.serverName ?? "My Server";
  const port = config?.serverPort;

  function hostAServer() {
    setShowSettings(false);
    setShowAddServer(true);
  }

  /** Put the running server in the rail and go look at it. */
  function openServer() {
    if (!state.serverUrl) return;
    const host = normalizeHost(state.serverUrl);
    if (!host) return;

    if (servers[host]) switchToServer(host);
    else addServer({ name, host }, true);

    setShowSettings(false);
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
          A server Gryt runs on this machine. It is yours: it holds its own
          messages and members, and it is only reachable while it is running and
          this machine is on.
        </Text>

        {!hasExistingServer && !isRunning && !isStarting ? (
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
            <Card size="2">
              <Flex direction="column" gap="3">
                <Flex align="center" gap="3">
                  <Avatar
                    size="3"
                    radius="full"
                    src={undefined}
                    fallback={<GeneratedServerIcon host={name} seed={name} />}
                  />

                  <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                    <Flex align="center" gap="2">
                      <Text size="2" weight="bold" truncate>
                        {name}
                      </Text>
                      <Badge
                        size="1"
                        color={
                          isRunning ? "green" : isStarting ? "amber" : "gray"
                        }
                      >
                        {isRunning
                          ? "Running"
                          : isStarting
                            ? "Starting…"
                            : "Stopped"}
                      </Badge>
                    </Flex>

                    {/* Both addresses, because they answer different
                        questions: the first is where this machine reaches it,
                        the second is what you give somebody else. */}
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">
                        <Code size="1" variant="ghost">
                          127.0.0.1:{port}
                        </Code>
                      </Text>
                      {config?.lanDiscoverable && (
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
                        onClick={() => {
                          void stopServer();
                        }}
                        disabled={loading}
                      >
                        {loading ? <Spinner size="1" /> : <PiStopFill size={16} />}
                        Stop
                      </Button>
                    ) : (
                      <Button
                        variant="soft"
                        onClick={() => {
                          void startServer();
                        }}
                        disabled={loading}
                      >
                        {loading ? <Spinner size="1" /> : <PiPlayFill size={16} />}
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
                      onCheckedChange={(c) => setAutoStart(c === true)}
                    />
                    <Text size="1" color="gray">
                      Start automatically with app
                    </Text>
                  </label>
                </Flex>

                {/* Behind an accordion, and genuinely unmounted when shut.
                    EmbeddedServerLogs pulls the whole history and opens a live
                    subscription the moment it mounts, so hiding it with CSS
                    would have kept both running for a panel nobody had asked
                    to see. Closed means not fetching. */}
                {(isRunning || isStarting) && (
                  <Accordion
                    value={logsOpen}
                    onValueChange={(value: unknown) =>
                      setLogsOpen(value as string[])
                    }
                  >
                    <Accordion.Item value="logs">
                      <Accordion.Trigger>Server logs</Accordion.Trigger>
                      <Accordion.Panel>
                        {logsOpen.includes("logs") && <EmbeddedServerLogs />}
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                )}
              </Flex>
            </Card>

            {/* Shown and disabled rather than hidden. A list with no way to add
                to it reads as a list that cannot grow, which is the wrong
                impression to leave — this is a limit, and it says so. */}
            <Tooltip content="Gryt runs one server per machine for now.">
              <Flex width="fit-content">
                <Button variant="soft" color="gray" disabled>
                  <PiPlusBold size={14} />
                  Host another server
                </Button>
              </Flex>
            </Tooltip>
          </>
        )}

        {hasError && state.error && (
          <Flex direction="column" gap="2">
            <Callout.Root color="red" role="alert">
              <Callout.Icon>
                <PiWarningFill size={16} />
              </Callout.Icon>
              <Callout.Text>{state.error}</Callout.Text>
            </Callout.Root>
            <Flex justify="end">
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => {
                  void dismissError();
                }}
              >
                <PiX size={14} />
                Dismiss
              </Button>
            </Flex>
          </Flex>
        )}
      </Flex>
    </SettingsContainer>
  );
}
