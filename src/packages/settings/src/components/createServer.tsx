import { Dialog } from "@gryt/ui";
import {
  Avatar,
  Button,
  Callout,
  Checkbox,
  Flex,
  Spinner,
  Text,
  TextField,
} from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { PiWarningFill, PiX } from "react-icons/pi";

import { GeneratedServerIcon } from "@/common";

import { useEmbeddedServer } from "../hooks/useEmbeddedServer";

interface CreateServerPanelProps {
  /** Called once the new server is up and reachable. */
  onServerReady: (serverUrl: string, serverName: string) => void;
  /** Back out to the step that chose this. */
  onBack: () => void;
}

/**
 * Making a server, and nothing else.
 *
 * This used to be the whole embedded-server manager — create form, running
 * card, logs, autostart, start and stop — reached through a dialog called "Add
 * a server". Managing something you already run is not adding one, and the two
 * jobs were taking turns in the same space depending on state you had no way
 * to predict from the outside. The manager lives in Settings → My servers now.
 *
 * Create finishes the job: it writes the config, starts the process and hands
 * the address back so the caller can join it. Previously it stopped after
 * writing the config and left a second button, Connect, as the thing that
 * actually got you there.
 */
export function CreateServerPanel({ onServerReady, onBack }: CreateServerPanelProps) {
  const { isAvailable, state, loading, createServer, dismissError } =
    useEmbeddedServer();

  const [serverName, setServerName] = useState("My Server");
  const [lanDiscoverable, setLanDiscoverable] = useState(true);
  /**
   * Set while this panel's own Create is in flight.
   *
   * The status effect below fires on any transition to running, including one
   * caused by autostart or by Settings starting the server in another panel.
   * Without this, opening the create form next to a server somebody else just
   * started would join it as if you had asked for that.
   */
  const creating = useRef(false);

  const isStarting = state.status === "starting";
  const hasError = state.status === "error";
  const busy = loading || isStarting || creating.current;

  useEffect(() => {
    if (!creating.current) return;

    if (state.status === "running" && state.serverUrl && state.config) {
      creating.current = false;
      onServerReady(state.serverUrl, state.config.serverName);
      return;
    }

    // A failure ends the attempt too, or the next unrelated start would be
    // treated as this one finally succeeding.
    if (state.status === "error") creating.current = false;
  }, [state, onServerReady]);

  if (!isAvailable) return null;

  async function handleCreate() {
    creating.current = true;
    await createServer(serverName.trim() || "My Server", lanDiscoverable);
  }

  return (
    <Flex direction="column" gap="4">
      {/* The icon leads, and it is already theirs before they have finished
          naming it. Seeded on the name rather than the address, because a
          server being created has no address yet and every new one drew the
          same planet until it started. */}
      <Flex direction="column" align="center" gap="1">
        <Avatar
          size="6"
          radius="full"
          src={undefined}
          fallback={<GeneratedServerIcon seed={serverName || "My Server"} />}
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
          autoFocus
          placeholder="My Server"
          value={serverName}
          onChange={(e) => setServerName(e.target.value)}
          disabled={busy}
          maxLength={64}
        />
      </Flex>

      {/* The one setting that survived the trim. It is not cosmetic: it decides
          whether anybody else on the network can find this server at all, and
          there is nowhere else to say so before it starts. */}
      <Flex asChild gap="2" align="center">
        <label>
          <Checkbox
            checked={lanDiscoverable}
            onCheckedChange={(c) => setLanDiscoverable(c === true)}
            disabled={busy}
          />
          <Text size="2" color="gray">
            Let others on my network find it
          </Text>
        </label>
      </Flex>

      <AnimatePresence>
        {hasError && state.error && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }}
          >
            <Callout.Root color="red" role="alert">
              <Callout.Icon>
                <PiWarningFill size={16} />
              </Callout.Icon>
              <Callout.Text>{state.error}</Callout.Text>
            </Callout.Root>
            <Flex mt="2" justify="end">
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
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog.Footer className="justify-between">
        <Button variant="ghost" color="gray" onClick={onBack} disabled={busy}>
          Back
        </Button>

        <Button
          onClick={() => {
            void handleCreate();
          }}
          disabled={busy || !serverName.trim()}
        >
          {busy ? <Spinner size="1" /> : null}
          {isStarting ? "Starting…" : "Create"}
        </Button>
      </Dialog.Footer>
    </Flex>
  );
}
