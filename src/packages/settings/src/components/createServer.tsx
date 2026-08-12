import { Accordion } from "@gryt/ui";
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Flex,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { PiCheck, PiHardDrivesFill, PiInfoFill, PiPlayFill, PiStopFill, PiWarningFill, PiX } from "react-icons/pi";

import { useEmbeddedServer } from "../hooks/useEmbeddedServer";
import { EmbeddedServerLogs } from "./embeddedServerLogs";

interface CreateServerPanelProps {
  onServerReady: (serverUrl: string, serverName: string) => void;
}

export function CreateServerPanel({ onServerReady }: CreateServerPanelProps) {
  const {
    isAvailable,
    hasExistingServer,
    existingConfig,
    lanIp,
    state,
    loading,
    autoStart,
    setAutoStart,
    createServer,
    startServer,
    stopServer,
    dismissError,
  } = useEmbeddedServer();

  const [serverName, setServerName] = useState("My Server");
  const [lanDiscoverable, setLanDiscoverable] = useState(true);
  /** Which accordion sections are open. Logs are not fetched until theirs is. */
  const [logsOpen, setLogsOpen] = useState<string[]>([]);

  if (!isAvailable) return null;

  const isRunning = state.status === "running";
  const isStarting = state.status === "starting";
  const hasError = state.status === "error";

  async function handleCreate() {
    await createServer(serverName.trim() || "My Server", lanDiscoverable);
  }

  async function handleStart() {
    await startServer();
  }

  async function handleStop() {
    await stopServer();
  }

  function handleConnect() {
    if (state.serverUrl && state.config) {
      onServerReady(state.serverUrl, state.config.serverName);
    }
  }

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2">
        <PiHardDrivesFill size={16} />
        <Text size="2" weight="bold">
          Host a server
        </Text>
        <Badge color="purple" size="1" variant="soft">
          Local
        </Badge>
      </Flex>

      <AnimatePresence mode="wait">
        {hasExistingServer && !isRunning && !isStarting ? (
          <motion.div
            key="existing"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <Card size="2">
              <Flex direction="column" gap="3">
                <Flex justify="between" align="center">
                  <Flex direction="column" gap="1">
                    <Text size="2" weight="bold">
                      {existingConfig?.serverName ?? "My Server"}
                    </Text>
                    <Text size="1" color="gray">
                      Port {existingConfig?.serverPort ?? "5000"}
                    </Text>
                  </Flex>
                  <Badge color="gray" size="1">Stopped</Badge>
                </Flex>
                <Flex asChild gap="2" align="center">
                  <label>
                    <Checkbox
                      checked={autoStart}
                      onCheckedChange={(c) => setAutoStart(c === true)}
                    />
                    <Text size="1" color="gray">Start automatically with app</Text>
                  </label>
                </Flex>
                <Button
                  size="2"
                  variant="soft"
                  onClick={() => { void handleStart(); }}
                  disabled={loading}
                >
                  {loading ? <Spinner size="1" /> : <PiPlayFill size={16} />}
                  Start server
                </Button>
              </Flex>
            </Card>
          </motion.div>
        ) : (isRunning || isStarting) ? (
          <motion.div
            key="running"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <Card size="2">
              <Flex direction="column" gap="3">
                <Flex justify="between" align="center">
                  <Flex direction="column" gap="1">
                    <Flex align="center" gap="2">
                      <Text size="2" weight="bold">
                        {state.config?.serverName ?? "Server"}
                      </Text>
                      <Badge color={isRunning ? "green" : "amber"} size="1">
                        {isRunning ? "Running" : "Starting..."}
                      </Badge>
                    </Flex>
                    <Text size="1" color="gray">
                      127.0.0.1:{state.config?.serverPort}
                      {state.config?.lanDiscoverable && ` (LAN: ${lanIp}:${state.config.serverPort})`}
                    </Text>
                  </Flex>
                </Flex>

                {/* Behind an accordion, and genuinely unmounted when shut.
                    EmbeddedServerLogs pulls the whole history and opens a live
                    subscription the moment it mounts, so hiding it with CSS
                    would have kept both running for a panel nobody had asked
                    to see. Closed means not fetching. */}
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

                <Flex asChild gap="2" align="center">
                  <label>
                    <Checkbox
                      checked={autoStart}
                      onCheckedChange={(c) => setAutoStart(c === true)}
                    />
                    <Text size="1" color="gray">Start automatically with app</Text>
                  </label>
                </Flex>

                <Flex gap="2">
                  {isRunning && (
                    <Button
                      size="2"
                      variant="soft"
                      color="green"
                      onClick={handleConnect}
                      style={{ flex: 1 }}
                    >
                      <PiCheck size={16} />
                      Connect
                    </Button>
                  )}
                  <Button
                    size="2"
                    variant="soft"
                    color="red"
                    onClick={() => { void handleStop(); }}
                    disabled={loading}
                    style={{ flex: isRunning ? undefined : 1 }}
                  >
                    {loading ? <Spinner size="1" /> : <PiStopFill size={16} />}
                    Stop
                  </Button>
                </Flex>
              </Flex>
            </Card>
          </motion.div>
        ) : (
          <motion.div
            key="create"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <Card size="2">
              <Flex direction="column" gap="3">
                <Flex direction="column" gap="2">
                  <Text size="2" color="gray" weight="bold">
                    Server name
                  </Text>
                  <TextField.Root
                    radius="full"
                    placeholder="My Server"
                    value={serverName}
                    onChange={(e) => setServerName(e.target.value)}
                    disabled={loading}
                  />
                </Flex>

                <Flex asChild gap="2" align="center">
                  <label>
                    <Checkbox
                      checked={lanDiscoverable}
                      onCheckedChange={(c) => setLanDiscoverable(c === true)}
                      disabled={loading}
                    />
                    <Text size="2">Discoverable on LAN</Text>
                  </label>
                </Flex>

                {lanDiscoverable && (
                  <Callout.Root color="blue" size="1">
                    <Callout.Icon>
                      <PiInfoFill size={14} />
                    </Callout.Icon>
                    <Callout.Text>
                      Other Gryt users on your network will see this server automatically.
                    </Callout.Text>
                  </Callout.Root>
                )}

                <Button
                  size="2"
                  onClick={() => { void handleCreate(); }}
                  disabled={loading || !serverName.trim()}
                >
                  {loading ? <Spinner size="1" /> : <PiHardDrivesFill size={16} />}
                  Create server
                </Button>
              </Flex>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {hasError && state.error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <Callout.Root color="red" role="alert">
              <Callout.Icon>
                <PiWarningFill size={16} />
              </Callout.Icon>
              <Callout.Text>
                {state.error}
              </Callout.Text>
            </Callout.Root>
            <Flex mt="2" justify="end">
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => { void dismissError(); }}
              >
                <PiX size={14} />
                Dismiss
              </Button>
            </Flex>
          </motion.div>
        )}
      </AnimatePresence>
    </Flex>
  );
}
