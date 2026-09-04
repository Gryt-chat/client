import { Accordion, Alert, AlertDialog, Avatar, Button, Checkbox, Chip, Spinner, Surface, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import { GeneratedServerIcon, normalizeHost } from "@/common";

import type { EmbeddedServerState } from "../../../../lib/electron";
import {
  PiHardDrivesFill,
  PiPlayFill,
  PiPlusBold,
  PiStopFill,
  PiTrashFill,
  PiWarningFill,
  PiX,
} from "../../../../lib/icons";
import { useServerManagement } from "../../../socket/src/hooks/useServerManagement";
import { useEmbeddedServer } from "../hooks/useEmbeddedServer";
import { useSettings } from "../hooks/useSettings";
import type { Servers } from "../types/server";
import { EmbeddedServerLogs } from "./embeddedServerLogs";
import { SettingsContainer } from "./settingsComponents";

/**
 * The servers you run, as opposed to the ones you have joined.
 *
 * This was the other half of the add-server dialog: a running-server card
 * shown or not depending on state, under a heading that said "Add a server".
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
    updateAdvertisedAddresses,
    updatePorts,
    deleteServer,
    isBusy,
    dismissError,
  } = useEmbeddedServer();
  const { setShowSettings } = useSettings();
  const { setShowAddServer, servers: joinedServers, removeServers } =
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
                onUpdateAdvertisedAddresses={(addresses) =>
                  updateAdvertisedAddresses(server.id, addresses)
                }
                onUpdatePorts={(ports) => updatePorts(server.id, ports)}
                onDelete={() => {
                  // The rail entries go with it. Left behind they point at an
                  // address nothing answers on, and look like a server that is
                  // merely offline rather than one that no longer exists.
                  removeServers(railEntriesFor(server, joinedServers));
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
 * Every rail entry pointing at a server this machine hosts.
 *
 * Matched on id, not address. The rail keys an entry on whatever address you
 * joined at, and joining your own server from the LAN keys it on 192.168.x.x
 * rather than 127.0.0.1 — so deleting the server left the other entry behind,
 * still holding the tokens and the pinned identity. The next server created
 * takes the same preferred port, inherits them, and is refused by a server that
 * never issued them.
 *
 * The config id here is SERVER_INSTANCE_ID, which is what the server reports as
 * its serverId. The address stays as a fallback for an entry added before the
 * server ever answered with one.
 */
function railEntriesFor(
  server: EmbeddedServerState,
  joined: Servers,
): string[] {
  const hosts = new Set<string>();

  for (const [host, entry] of Object.entries(joined)) {
    if (entry.serverId && entry.serverId === server.id) hosts.add(host);
  }

  const loopback = server.serverUrl ? normalizeHost(server.serverUrl) : "";
  if (loopback && joined[loopback]) hosts.add(loopback);

  return [...hosts];
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
  onUpdateAdvertisedAddresses,
  onUpdatePorts,
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
  onUpdateAdvertisedAddresses: (addresses: string[]) => Promise<boolean>;
  onUpdatePorts: (ports: {
    serverPort?: number;
    sfuPort?: number;
    mediaPort?: number;
  }) => Promise<string | null>;
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
  const [customAddresses, setCustomAddresses] = useState("");
  const [addressSaveFailed, setAddressSaveFailed] = useState(false);
  /** Which accordion sections are open, ports included. */
  const [portsOpen, setPortsOpen] = useState<string[]>([]);
  /** The fields, as typed. Empty until the panel is opened and seeded. */
  const [portDraft, setPortDraft] = useState({ server: "", sfu: "", media: "" });
  const [portError, setPortError] = useState<string | null>(null);
  const [portsSaved, setPortsSaved] = useState(false);

  const isRunning = server.status === "running";
  const isStarting = server.status === "starting";
  const hasError = server.status === "error";
  const name = server.config?.serverName ?? "My Server";
  const port = server.config?.serverPort;
  const host = server.serverUrl ? normalizeHost(server.serverUrl) : "";

  useEffect(() => {
    setCustomAddresses(
      server.config?.customAdvertisedAddresses.join(", ") ?? "",
    );
    setAddressSaveFailed(false);
  }, [server.config?.customAdvertisedAddresses]);

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
                <code className="font-mono text-xs text-gryt-muted">
                  127.0.0.1:{port}
                </code>
              </span>
              {server.config?.lanDiscoverable && (
                <span className="text-xs">
                  On your network{" "}
                  <code className="font-mono text-xs text-gryt-muted">
                    {lanIp}:{port}
                  </code>
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
              <AlertDialog.Popup>
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
                <AlertDialog.Close
                  render={
                    <Button size="small">
                      Cancel
                    </Button>
                  }
                />
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

        <div className="flex flex-col gap-2 border-t border-gryt-border pt-3">
          <span className="text-sm font-bold">Advertised addresses</span>
          <span className="text-xs">
            Voice currently advertises{" "}
            {server.config?.advertisedAddresses.length ? (
              server.config.advertisedAddresses.map((address, index) => (
                <span key={address}>
                  {index > 0 ? ", " : ""}
                  <code className="font-mono text-xs text-gryt-muted">
                    {address}
                  </code>
                </span>
              ))
            ) : (
              "no external address"
            )}
            . Gryt adds usable addresses from this machine automatically.
          </span>
          {/* Where the symptom is, next to the thing that causes it.
              
              A wrong address here does not look like a network fault, it looks
              like broken audio: chat goes over the address people joined on and
              keeps working, while media goes direct to whatever is advertised
              here. Nothing else in the app connects those two facts. GRYT-297.
              
              The app deliberately does not claim these addresses work. It
              cannot tell from in here — a machine behind NAT may or may not
              reach its own public IP depending on the router, and neither
              answer describes what somebody outside sees. */}
          <span className="text-xs text-gryt-muted">
            If people can chat but nobody can hear anyone, this is the first
            thing to check: voice connects directly to these addresses, so an
            address that is wrong, or a UDP port that is not forwarded, breaks
            audio and nothing else. It can only be tested from outside your
            network.
          </span>
          <div className="flex gap-2 items-end">
            <label className="flex flex-col gap-1 flex-1">
              <span className="text-xs">Public IPs or hostnames</span>
              <TextField
                value={customAddresses}
                onChange={(event) => {
                  setCustomAddresses(event.target.value);
                  setAddressSaveFailed(false);
                }}
                placeholder="203.0.113.10, voice.example.com"
                disabled={isRunning || isStarting || busy}
              />
            </label>
            <Button
              size="small"
              disabled={isRunning || isStarting || busy}
              onClick={() => {
                const addresses = customAddresses
                  .split(",")
                  .map((address) => address.trim())
                  .filter(Boolean);
                void onUpdateAdvertisedAddresses(addresses).then((saved) =>
                  setAddressSaveFailed(!saved),
                );
              }}
            >
              Save
            </Button>
          </div>
          {(isRunning || isStarting) && (
            <span className="text-xs text-gryt-muted">
              Stop the server before changing these addresses.
            </span>
          )}
          {addressSaveFailed && (
            <Alert severity="info" role="alert">
              Use IPv4 addresses or fully qualified hostnames without ports.
              Not <code className="font-mono text-xs">0.0.0.0</code> or{" "}
              <code className="font-mono text-xs">127.0.0.1</code> — those mean
              &quot;this machine&quot; to whoever reads them, so a client sent
              one looks for the server on its own computer.
            </Alert>
          )}
        </div>

          {/* The ports, behind an accordion, and editable.
              
              The paragraph above has said for a while that a UDP port not
              being forwarded is what breaks audio, without ever saying which
              port — which told the reader exactly what was wrong and nothing
              about what to type into a router. GRYT-459 put the numbers here.
              
              They are fields rather than text because the app no longer moves
              a port when something else takes it. It refuses to start and says
              so, and this is where that gets fixed. GRYT-469. */}
          <Accordion
            value={portsOpen}
            onValueChange={(value: unknown) => {
              const next = value as string[];
              // Seed from the config on open rather than on every render, so
              // typing is not overwritten by a status broadcast mid-edit.
              if (next.includes("ports") && !portsOpen.includes("ports")) {
                setPortDraft({
                  server: String(server.config?.serverPort ?? ""),
                  sfu: String(server.config?.sfuPort ?? ""),
                  media: String(server.config?.mediaPort ?? ""),
                });
                setPortError(null);
                setPortsSaved(false);
              }
              setPortsOpen(next);
            }}
          >
            <Accordion.Item value="ports">
              <Accordion.Trigger>Open these ports</Accordion.Trigger>
              <Accordion.Panel>
                <div className="flex flex-col gap-3 pt-2">
                  <span className="text-xs text-gryt-muted">
                    Open these on this machine, and forward them on your router
                    as well if anyone is joining from outside your network. The
                    UDP one is the one people miss: it is a different protocol
                    from the other two, and everything except voice works
                    without it.
                  </span>

                  <div className="flex gap-2 items-end">
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-xs">TCP, the server</span>
                      <TextField
                        value={portDraft.server}
                        inputMode="numeric"
                        onChange={(event) => {
                          setPortDraft((d) => ({ ...d, server: event.target.value }));
                          setPortError(null);
                          setPortsSaved(false);
                        }}
                        disabled={isRunning || isStarting || busy}
                      />
                    </label>
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-xs">TCP, voice signalling</span>
                      <TextField
                        value={portDraft.sfu}
                        inputMode="numeric"
                        onChange={(event) => {
                          setPortDraft((d) => ({ ...d, sfu: event.target.value }));
                          setPortError(null);
                          setPortsSaved(false);
                        }}
                        disabled={isRunning || isStarting || busy}
                      />
                    </label>
                    <label className="flex flex-col gap-1 flex-1">
                      <span className="text-xs">UDP, voice and video</span>
                      <TextField
                        value={portDraft.media}
                        inputMode="numeric"
                        onChange={(event) => {
                          setPortDraft((d) => ({ ...d, media: event.target.value }));
                          setPortError(null);
                          setPortsSaved(false);
                        }}
                        disabled={isRunning || isStarting || busy}
                      />
                    </label>
                    <Button
                      size="small"
                      disabled={isRunning || isStarting || busy}
                      onClick={() => {
                        const parsed = {
                          serverPort: Number(portDraft.server),
                          sfuPort: Number(portDraft.sfu),
                          mediaPort: Number(portDraft.media),
                        };
                        void onUpdatePorts(parsed).then((error) => {
                          setPortError(error);
                          setPortsSaved(!error);
                        });
                      }}
                    >
                      Save
                    </Button>
                  </div>

                  {/* Said here as well as under the addresses, because this
                      panel is collapsed by default and somebody who opens it
                      to change a port has not necessarily read that. */}
                  {(isRunning || isStarting) && (
                    <span className="text-xs text-gryt-muted">
                      Stop the server before changing its ports.
                    </span>
                  )}

                  {portError && (
                    <Alert severity="info" role="alert">
                      {portError}
                    </Alert>
                  )}

                  {portsSaved && (
                    <Alert severity="success" role="status">
                      Saved. Remember to forward the new port, if you had
                      forwarded the old one.
                    </Alert>
                  )}

                  <span className="text-xs text-gryt-muted">
                    Voice signalling is shared by every server this app hosts,
                    so changing those two changes them for all of them.
                  </span>
                </div>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>

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
