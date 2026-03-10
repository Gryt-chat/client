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
import {
  MdCheck,
  MdClose,
  MdDns,
  MdInfoOutline,
  MdPlayArrow,
  MdStop,
  MdWarning,
} from "react-icons/md";

import { useEmbeddedServer } from "../hooks/useEmbeddedServer";

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
  } = useEmbeddedServer();

  const [serverName, setServerName] = useState("My Server");
  const [lanDiscoverable, setLanDiscoverable] = useState(true);

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
        <MdDns size={16} />
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
                  {loading ? <Spinner size="1" /> : <MdPlayArrow size={16} />}
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
                      <MdCheck size={16} />
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
                    {loading ? <Spinner size="1" /> : <MdStop size={16} />}
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
                      <MdInfoOutline size={14} />
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
                  {loading ? <Spinner size="1" /> : <MdDns size={16} />}
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
                <MdWarning size={16} />
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
                onClick={() => { void handleStop(); }}
              >
                <MdClose size={14} />
                Dismiss
              </Button>
            </Flex>
          </motion.div>
        )}
      </AnimatePresence>
    </Flex>
  );
}
