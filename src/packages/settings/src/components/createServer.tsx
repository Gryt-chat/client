import { Accordion, Dialog } from "@gryt/ui";
import {
  Avatar,
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
import { PiCheck, PiPlayFill, PiStopFill, PiWarningFill, PiX } from "react-icons/pi";

import { GeneratedServerIcon } from "@/common";

import { useEmbeddedServer } from "../hooks/useEmbeddedServer";
import { EmbeddedServerLogs } from "./embeddedServerLogs";

interface CreateServerPanelProps {
  onServerReady: (serverUrl: string, serverName: string) => void;
  /** Back out to the step that chose this. */
  onBack: () => void;
}

export function CreateServerPanel({ onServerReady, onBack }: CreateServerPanelProps) {
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

  function handleConnect() {
    if (state.serverUrl && state.config) {
      onServerReady(state.serverUrl, state.config.serverName);
    }
  }

  return (
    <Flex direction="column" gap="4">
      <AnimatePresence mode="wait">
        {hasExistingServer && !isRunning && !isStarting ? (
          <motion.div
            key="existing"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <Card size="2">
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
            {/* Icon and name, and nothing else on the way to a server. The
                icon leads, and it is already theirs before they have finished
                naming it — seeded on the name rather than the address, because
                a server being created has no address yet and every new one
                drew the same planet until it started. */}
            <Flex direction="column" gap="4">
              <Flex direction="column" align="center" gap="1">
                <Avatar
                  size="6"
                  radius="full"
                  src={undefined}
                  fallback={
                    <GeneratedServerIcon
                      host={serverName}
                      seed={serverName || "My Server"}
                    />
                  }
                />
                <Text size="1" color="gray">
                  Generated from the name
                </Text>
              </Flex>

              <Flex direction="column" gap="2">
                <Text size="2" weight="bold">
                  Server name{" "}
                  <Text as="span" color="red">
                    *
                  </Text>
                </Text>
                <TextField.Root
                  placeholder="My Server"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  disabled={loading}
                />
              </Flex>

              {/* The one setting that survived the trim. It is not cosmetic:
                  it decides whether anybody else on the network can find this
                  server at all, and there is no other place to say so before
                  it starts. */}
              <Flex asChild gap="2" align="center">
                <label>
                  <Checkbox
                    checked={lanDiscoverable}
                    onCheckedChange={(c) => setLanDiscoverable(c === true)}
                    disabled={loading}
                  />
                  <Text size="2" color="gray">
                    Let others on my network find it
                  </Text>
                </label>
              </Flex>
            </Flex>
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

      {/* Autostart sits with the footer rather than in the form. It is about
          every launch after this one, not about the server being made. */}
      {(hasExistingServer || isRunning || isStarting) && (
        <Flex asChild gap="2" align="center">
          <label>
            <Checkbox
              checked={autoStart}
              onCheckedChange={(c) => setAutoStart(c === true)}
            />
            <Text size="1" color="gray">Start automatically with app</Text>
          </label>
        </Flex>
      )}

      <Dialog.Footer className="justify-between">
        <Button variant="ghost" color="gray" onClick={onBack} disabled={loading}>
          Back
        </Button>

        <Flex gap="2">
          {(isRunning || isStarting) && (
            <Button
              variant="soft"
              color="red"
              onClick={() => { void stopServer(); }}
              disabled={loading}
            >
              {loading ? <Spinner size="1" /> : <PiStopFill size={16} />}
              Stop
            </Button>
          )}

          {isRunning ? (
            <Button onClick={handleConnect}>
              <PiCheck size={16} />
              Connect
            </Button>
          ) : isStarting ? (
            <Button disabled>
              <Spinner size="1" />
              Starting…
            </Button>
          ) : hasExistingServer ? (
            <Button onClick={() => { void startServer(); }} disabled={loading}>
              {loading ? <Spinner size="1" /> : <PiPlayFill size={16} />}
              Start server
            </Button>
          ) : (
            <Button
              onClick={() => { void handleCreate(); }}
              disabled={loading || !serverName.trim()}
            >
              {loading ? <Spinner size="1" /> : null}
              Create
            </Button>
          )}
        </Flex>
      </Dialog.Footer>
    </Flex>
  );
}
