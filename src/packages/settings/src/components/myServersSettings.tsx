import { Accordion, Alert, AlertDialog, Avatar, Button, Checkbox, Chip, Spinner, Surface, TextField } from "@gryt/ui";
import { Code } from "@radix-ui/themes";
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
        <h2 className="text-lg">
          My servers
        </h2>
        <span className="text-sm">
          This build does not have a server bundled with it, so there is nothing
          to run here. Joining somebody else&rsquo;s works as normal.
        </span>
      </SettingsContainer>
    );
  }

  return (
    <SettingsContainer>
      <h2 className="text-lg">
        My servers
      </h2>

      <div className="flex flex-col gap-3">
        <span className="text-xs">
          Servers Gryt runs on this machine. They are yours: each one holds its
          own messages and members, and is only reachable while it is running
          and this machine is on.
        </span>

        {servers.length === 0 ? (
          <div className="flex flex-col gap-3 items-start">
            <span className="text-sm">
              You are not running one yet.
            </span>
            <Button size="small" onClick={hostAServer}>
              <PiHardDrivesFill size={16} />
              Host a server
            </Button>
          </div>
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

            <div className="flex w-fit">
              <Button size="small" onClick={hostAServer}>
                <PiPlusBold size={14} />
                Host another server
              </Button>
            </div>
          </>
        )}
      </div>
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
    <Surface className="p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Avatar fallback={<GeneratedServerIcon seed={name} />} />

          <div className="flex flex-col gap-1" style={{ minWidth: 0 }}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold truncate">
                {name}
              </span>
              <Chip tone="neutral"
                color={isRunning ? "green" : isStarting ? "amber" : "gray"}
              >
                {isRunning ? "Running" : isStarting ? "Starting…" : "Stopped"}
              </Chip>
            </div>

            {/* Both addresses, because they answer different questions: the
                first is where this machine reaches it, the second is what you
                give somebody else. */}
            <div className="flex flex-col gap-1">
              <span className="text-xs">
                <Code size="1" variant="ghost">
                  127.0.0.1:{port}
                </Code>
              </span>
              {server.config?.lanDiscoverable && (
                <span className="text-xs">
                  On your network{" "}
                  <Code size="1" variant="ghost">
                    {lanIp}:{port}
                  </Code>
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2 items-center ml-auto">
            {isRunning || isStarting ? (
              <Button size="small"
                onClick={onStop}
                disabled={busy}
              >
                {busy ? <Spinner size={16} /> : <PiStopFill size={16} />}
                Stop
              </Button>
            ) : (
              <Button size="small"
                onClick={onStart}
                disabled={busy}
              >
                {busy ? <Spinner size={16} /> : <PiPlayFill size={16} />}
                Start
              </Button>
            )}

            <Button size="small" onClick={openServer} disabled={!isRunning}>
              Open
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex gap-2 items-center">
              <Checkbox
                checked={autoStart}
                onCheckedChange={(c) => onAutoStart(c === true)}
              />
              <span className="text-xs">
                Start automatically with app
              </span>
            </label>

          <AlertDialog.Root
            open={confirmDelete}
            onOpenChange={(open) => {
              setConfirmDelete(open);
              if (!open) setTypedName("");
            }}
          >
            <Button
              tone="ghost"
              size="xsmall"
              className="ml-auto"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              <PiTrashFill size={12} />
              Delete
            </Button>

            <AlertDialog.Portal>
              <AlertDialog.Backdrop />
              <AlertDialog.Popup className="max-w-[460px]">
              <AlertDialog.Title>Delete {name}?</AlertDialog.Title>
              <AlertDialog.Description>
                This deletes the server and everything on it — its messages, its
                members, its uploads and its identity key. There is no other
                copy.
              </AlertDialog.Description>

              {/* Said separately because it is the part nobody expects.
                  Everyone who joined pinned this server's identity key, so a
                  new server with the same name and port is a different server
                  to them, and they are turned away rather than let back in. */}
              <p className="text-sm mt-3">
                Anybody who joined cannot rejoin a replacement, even with the
                same name and port.
              </p>

              <div className="flex flex-col gap-2 mt-4">
                <span className="text-sm">
                  Type <strong>{name}</strong> to confirm.
                </span>
                <TextField
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder={name}
                  autoFocus
                />
              </div>

              <div className="flex gap-3 mt-4 justify-end">
                <AlertDialog.Close render={<span />}>
                  <Button size="small">
                    Cancel
                  </Button>
                </AlertDialog.Close>
                <Button size="small"
                  disabled={typedName.trim() !== name}
                  onClick={() => {
                    setConfirmDelete(false);
                    setTypedName("");
                    onDelete();
                  }}
                >
                  Delete for good
                </Button>
              </div>
            </AlertDialog.Popup>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </div>

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
          <div className="flex flex-col gap-2">
            <Alert severity="info" role="alert"><span className="inline-flex items-start gap-2"><PiWarningFill size={16} />{server.error}</span></Alert>
            <div className="flex justify-end">
              <Button tone="ghost" size="xsmall" onClick={onDismissError}>
                <PiX size={14} />
                Dismiss
              </Button>
            </div>
          </div>
        )}
      </div>
    </Surface>
  );
}
