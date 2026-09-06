import { AlertDialog, Avatar, Button, ContextMenu, IconButton, Menu, PreviewCard, Tooltip } from "@gryt/ui";
import { useSFU } from "@gryt/voice";
import { Reorder } from "motion/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import toast from "react-hot-toast";

import {
  GeneratedServerIcon,
  getOwnLevel,
  getPrefsSnapshot,
  normalizeHost,
  type NotificationLevel,
  resolveAvatarSrc,
  serverIconSrc,
  setNotificationLevel,
  subscribeToPrefs,
  useAccount,
  useUnreadTracker,
} from "@/common";
import { useSettings } from "@/settings";
import { useEmbeddedServer } from "@/settings/src/hooks/useEmbeddedServer";
import { useLanDiscovery } from "@/settings/src/hooks/useLanDiscovery";
import {
  Server,
  serverDetailsList as ServerDetailsListType,
  Servers,
} from "@/settings/src/types/server";
import { useServerManagement, useSockets } from "@/socket";
import { ServerDoctor } from "@/socket/src/components/ServerDoctor";
import type { ServerRingState } from "@/socket/src/components/ServerStatusRing";
import { ServerStatusRing } from "@/socket/src/components/ServerStatusRing";
import { MiniControls } from "@/webRTC/src/components/miniControls";

import { useIdentityClaim } from "../hooks/useIdentityClaim";
import { PiBroadcastFill, PiBugFill, PiChatCircleDotsFill, PiGearFill, PiMicrophoneFill, PiPlus, PiSignInFill } from "../lib/icons";
import { useReportForm } from "../lib/reports/useReportForm";


interface SidebarProps {
  setShowAddServer: (show: boolean) => void;
}


/**
 * How loud a whole server is, as the three levels plus a reset.
 *
 * The same four the channel list offers per channel and per folder. Declared
 * once out here because the menu renders per server in a map.
 */
const SERVER_NOTIFICATION_CHOICES: { label: string; value: NotificationLevel | null }[] = [
  { label: "Everything", value: "all" },
  { label: "Only mentions", value: "mentions" },
  { label: "Nothing", value: "none" },
  { label: "Default (everything)", value: null },
];

/** Opens the settings modal, on a named tab when one is asked for. */
function openServerSettings(host: string, tab?: string): void {
  window.dispatchEvent(
    new CustomEvent("server_settings_open", { detail: tab ? { host, tab } : { host } }),
  );
}

async function copyServerAddress(host: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(host);
    toast.success("Server address copied");
  } catch {
    // Clipboard access can be refused, and a row that silently does nothing
    // reads as a broken menu item.
    toast.error("Could not copy the address");
  }
}

export function Sidebar({ setShowAddServer }: SidebarProps) {
  const { isSignedIn, login, logout } = useAccount();
  const { nickname, avatarDataUrl, setShowSettings } = useSettings();
  const { open: openReport } = useReportForm();

  const {
    servers,
    currentlyViewingServer,
    setShowRemoveServer,
    switchToServer,
    orderedServerHosts,
    reorderServers,
    duplicatesOf,
    mergeDuplicates,
    showDiscovery,
    setShowDiscovery,
    newLanServers,
  } = useServerManagement();
  const { isElectron } = useLanDiscovery();

  /**
   * Which rail entries are servers this machine is running, and what the
   * manager says they are doing.
   *
   * The connection status alone cannot tell "my server is booting" from "a
   * stranger's server has not answered" (GRYT-314). Empty in a browser.
   */
  const { servers: embeddedServers } = useEmbeddedServer();
  const embeddedStatusByHost = useMemo(() => {
    const map: Record<string, string> = {};
    for (const server of embeddedServers) {
      if (!server.serverUrl) continue;
      map[normalizeHost(server.serverUrl.replace(/^https?:\/\//, ""))] = server.status;
    }
    return map;
  }, [embeddedServers]);

  const { currentServerConnected, isConnected } = useSFU();
  const { serverConnectionStatus, serverProfiles, serverDetailsList } =
    useSockets();
  const { serverHasUnread } = useUnreadTracker();

  const currentHost = currentlyViewingServer?.host;
  const activeProfile = currentHost ? serverProfiles[currentHost] : undefined;
  const displayNickname = activeProfile?.nickname || nickname;
  // The same nickname shown under it, so your face here is the one everyone
  // else sees — and it changes when you rename, which is the whole point of
  // seeding from the nickname.
  const displayAvatarUrl = resolveAvatarSrc(
    activeProfile?.avatarUrl || avatarDataUrl,
    displayNickname,
    activeProfile?.avatarWorn,
  );
  return (
    <div className="flex flex-col h-full gap-4 items-center justify-between" data-gryt="sidebar">
      <div className="flex flex-col gap-4 pt-2">
        <Reorder.Group
          axis="y"
          values={orderedServerHosts}
          onReorder={reorderServers}
          as="div"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            listStyle: "none",
            padding: 0,
            margin: 0,
          }}
        >
          {orderedServerHosts.map((host) => (
            <ServerItem
              key={host}
              host={host}
              servers={servers}
              /* Nothing in the list is current while Discovery has the pane.
                 Leaving the last server lit says you are looking at it. */
              currentlyViewingServer={showDiscovery ? null : currentlyViewingServer}
              serverConnectionStatus={serverConnectionStatus}
              serverDetailsList={serverDetailsList}
              isConnected={isConnected}
              currentServerConnected={currentServerConnected}
              serverHasUnread={serverHasUnread}
              switchToServer={switchToServer}
              setShowRemoveServer={setShowRemoveServer}
              duplicateHosts={duplicatesOf(host)}
              mergeDuplicates={mergeDuplicates}
              embeddedStatus={embeddedStatusByHost[host]}
            />
          ))}
        </Reorder.Group>
        <Tooltip title="Add new server" side="right">
          <IconButton tone="neutral" size="xsmall"
            data-tour="add-server"
            onClick={() => setShowAddServer(true)}
          >
            <PiPlus size={16} />
          </IconButton>
        </Tooltip>

        {/* Discovery is Electron-only because mDNS browsing is. A browser
            would get a destination that can never have anything in it. */}
        {isElectron && (
          <Tooltip
            title="Servers on your network"
            side="right"
          >
            <div className="relative">
              <IconButton tone="neutral" size="xsmall"
                // The badge is aria-hidden, so the count has to be said here
                // or it is not announced at all.
                aria-label={
                  newLanServers.length > 0 && !showDiscovery
                    ? `Servers on your network, ${newLanServers.length} new`
                    : "Servers on your network"
                }
                onClick={() => setShowDiscovery(!showDiscovery)}
              >
                <PiBroadcastFill size={16} />
              </IconButton>

              {/* A count, and it is a count of new ones.
                  
                  This was a dot, on the reasoning that a number would sit
                  permanently at six because six servers run on this machine.
                  That is true of a count of the network; it is not true of
                  this one. newLanServers is pendingLanServers minus the ones
                  already seen, so it holds only what has turned up since
                  Discovery was last open and it empties when you look. */}
              {newLanServers.length > 0 && !showDiscovery && (
                <div
                  className="absolute flex items-center justify-center"
                  aria-hidden
                  style={{
                    top: "-4px",
                    right: "-4px",
                    minWidth: 16,
                    height: 16,
                    // Pill rather than a circle once it reaches two digits.
                    padding: "0 4px",
                    borderRadius: 8,
                    backgroundColor: "var(--gryt-accent-9)",
                    color: "var(--gryt-on-accent)",
                    border: "2px solid var(--gryt-neutral-1)",
                    fontSize: 10,
                    fontWeight: 700,
                    lineHeight: 1,
                    zIndex: 1,
                    pointerEvents: "none",
                  }}
                >
                  {newLanServers.length > 9 ? "9+" : newLanServers.length}
                </div>
              )}
            </div>
          </Tooltip>
        )}
      </div>

      <div className="flex justify-center items-center flex-col gap-3 pb-3">
        {/* Voice chat controls */}
        <MiniControls direction="column" />
        <Menu.Root>
          {/* render, not children. Menu.Trigger is itself a button, so a
              button inside it is a button inside a button — invalid HTML that
              React warns about and browsers resolve however they like. render
              merges the two into one element. */}
          <Menu.Trigger render={<IconButton size="xsmall" data-tour="profile" />}>
            <Avatar
              fallback={displayNickname[0]}
              src={displayAvatarUrl || undefined}
            />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup>
            <Menu.Item
              data-tour="menu-settings"
              onClick={() => setShowSettings(true)}
            >
              <div className="flex items-center gap-1">
                <PiGearFill size={14} />
                Settings
              </div>
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item onClick={() => openReport("feedback")}>
              <div className="flex items-center gap-1">
                <PiChatCircleDotsFill size={14} />
                Give feedback
              </div>
            </Menu.Item>
            {/* Kept separate from feedback rather than folded into it. Both
                open the same form and the service stores them the same way
                with a different label — but "Give feedback" is a suggestion box
                and this is for when something is broken, and somebody who has
                just lost a call should not have to decide which box that is. */}
            <Menu.Item onClick={() => openReport("bug")}>
              <div className="flex items-center gap-1">
                <PiBugFill size={14} />
                Report a bug
              </div>
            </Menu.Item>
            {/* Guest-by-default (GRYT-173) means most people on a first run
                have no account, and offering them a way out of one they never
                had is both wrong and a wasted invitation. `isSignedIn` is
                undefined until Keycloak answers, so neither item is shown
                until it does — a control that changes label a beat after you
                open the menu is worse than one that arrives a beat late. */}
            {isSignedIn !== undefined && (
              <>
                <Menu.Separator />
                {isSignedIn ? (
                  <Menu.Item className="text-gryt-danger" onClick={logout}>
                    Sign out
                  </Menu.Item>
                ) : (
                  <Menu.Item onClick={login}>
                    <div className="flex items-center gap-1">
                      <PiSignInFill size={14} />
                      Sign in
                    </div>
                  </Menu.Item>
                )}
              </>
            )}
          </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}

interface ServerItemProps {
  host: string;
  servers: Servers;
  currentlyViewingServer: Server | null;
  serverConnectionStatus: Record<string, string>;
  serverDetailsList: ServerDetailsListType;
  isConnected: boolean;
  currentServerConnected: string | null;
  serverHasUnread: (host: string) => boolean;
  switchToServer: (host: string) => void;
  setShowRemoveServer: (host: string | null) => void;
  /** Other addresses in the rail that are this same server (GRYT-317). */
  duplicateHosts: string[];
  mergeDuplicates: (keepHost: string) => void;
  /** The embedded manager's status, when this rail entry is a server we run. */
  embeddedStatus?: string;
}

/**
 * How long a server with no connection status yet is given before it is called
 * offline. Long enough to cover creating an embedded server and the socket
 * being set up, short enough that a genuinely dead host does not sit there
 * claiming to connect.
 */
const UNKNOWN_SETTLE_MS = 10_000;

function ServerItem({
  host,
  servers,
  currentlyViewingServer,
  serverConnectionStatus,
  serverDetailsList,
  isConnected,
  currentServerConnected,
  serverHasUnread,
  switchToServer,
  setShowRemoveServer,
  duplicateHosts,
  mergeDuplicates,
  embeddedStatus,
}: ServerItemProps) {
  const { canClaim, claim } = useIdentityClaim();
  /* Subscribed rather than read once, so the tick in the notifications
     submenu moves the moment a level is picked. The value is unused; the
     subscription is what re-renders, and `getOwnLevel` reads the current
     answer where the rows are drawn. */
  useSyncExternalStore(subscribeToPrefs, getPrefsSnapshot, getPrefsSnapshot);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  // No entry yet is not the same as down.
  //
  // A server added a moment ago has no status until useSockets gets round to
  // creating its socket and sets "connecting". Falling back to "disconnected"
  // rendered it greyed out with "• OFFLINE" beside it before anything had been
  // attempted, so creating a server looked like it had failed (GRYT-290). An
  // unknown host reads as connecting and only becomes offline once it has had
  // SETTLE_MS to say otherwise.
  const rawStatus = serverConnectionStatus[host];
  const [settleExpired, setSettleExpired] = useState(false);
  useEffect(() => {
    if (rawStatus) return;
    setSettleExpired(false);
    const timer = window.setTimeout(() => setSettleExpired(true), UNKNOWN_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [rawStatus]);

  const connectionStatus =
    rawStatus ?? (settleExpired ? "disconnected" : "connecting");
  const isOffline = connectionStatus === "disconnected";
  const isConnecting = connectionStatus === "connecting";
  const isReconnecting = connectionStatus === "reconnecting";
  const isUnavailable = isOffline && !isConnecting;

  /**
   * A server of ours that is still booting. Not a connection state — the
   * socket has nothing to report yet either way — but it is the thing the
   * person watching actually wants to know (GRYT-314).
   */
  const isStarting = embeddedStatus === "starting" && !isConnected;

  /**
   * Nothing has come back yet and the clock is running. This is the one
   * waiting state with a deadline, so it is the one drawn as a deadline.
   */
  const isSettling = !rawStatus && !settleExpired && !isStarting;

  const ringState: ServerRingState = isStarting
    ? "starting"
    : isSettling
      ? "settling"
      : isReconnecting
        ? "reconnecting"
        : isConnecting
          ? "connecting"
          : "none";
  /* Waiting on a moderator (GRYT-289). Not a connection state: the server is
     reachable and answering, it just has not let this person in yet. */
  const awaitingApproval = Boolean(servers[host]?.approvalRequestedAt);

  return (
    <Reorder.Item
      value={host}
      as="div"
      style={{ listStyle: "none", cursor: "grab", userSelect: "none" }}
      whileDrag={{
        scale: 1.1,
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        zIndex: 10,
        cursor: "grabbing",
        borderRadius: "var(--gryt-radius-sm)",
      }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <PreviewCard.Root>
        <ContextMenu.Root>
          <ContextMenu.Trigger>
            <PreviewCard.Trigger>
              <div className="relative" onDragStart={(e) => e.preventDefault()}>
                <Avatar
                  size="small"
                  className="rounded-(--gryt-radius-md) p-0"
                  render={
                    <button
                      type="button"
                      style={{
                        cursor: isUnavailable ? "not-allowed" : "pointer",
                      }}
                      onClick={() => {
                        if (!isUnavailable) {
                          switchToServer(host);
                        }
                      }}
                    />
                  }
                  fallback={<GeneratedServerIcon seed={servers[host]?.name || host} />}
                  style={{
                    // A server you just created keeps its colour. Greying it
                    // would say "something is wrong here", and nothing is —
                    // it is doing exactly what you asked. The ring carries
                    // that it is not ready yet (GRYT-314).
                    opacity:
                      currentlyViewingServer?.host === host || isStarting
                        ? 1
                        : isUnavailable
                        ? 0.3
                        : awaitingApproval
                        ? 0.4
                        : isReconnecting
                        ? undefined
                        : 0.5,
                    filter:
                      !isStarting &&
                      (isUnavailable || isReconnecting || awaitingApproval)
                        ? "grayscale(100%)"
                        : "none",
                    // The reconnect pulse is gone: it and the connecting state
                    // looked the same from across the room, and a ring says
                    // which is which without dimming the artwork.
                  }}
                  src={serverIconSrc(host, servers[host]?.name || "", serverDetailsList)}
                />

                <ServerStatusRing state={ringState} settleMs={UNKNOWN_SETTLE_MS} />

                {isConnected && currentServerConnected === host && (
                  <div className="absolute" style={{ top: "-2px", right: "-2px", width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      backgroundColor: "var(--gryt-accent-9)",
                      border: "2px solid var(--gryt-neutral-1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 1 }}>
                    <PiMicrophoneFill size={8} color="var(--gryt-on-accent)" />
                  </div>
                )}
                {serverHasUnread(host) && (
                  <div className="absolute" style={{ bottom: "-2px", right: "-2px", width: 10,
                      height: 10,
                      borderRadius: "50%",
                      backgroundColor: "var(--gryt-accent-9)",
                      border: "2px solid var(--gryt-neutral-1)",
                      zIndex: 1,
                      pointerEvents: "none" }} />
                )}
              </div>
            </PreviewCard.Trigger>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Positioner>
              <ContextMenu.Popup>
            {/* The label names a group, and Base UI reads the group's id off
                context to point aria-labelledby at it. Without one it throws,
                which is what a right-click here used to do. */}
            <ContextMenu.Group>
              <ContextMenu.GroupLabel style={{ fontWeight: "bold" }}>
                {servers[host].name}
              </ContextMenu.GroupLabel>
            </ContextMenu.Group>
            {/*
              Ordered like the server menu people arrive already knowing:
              invite, then how loud it is, then settings, then what you make,
              then leaving, then the identifier.

              What Gryt has no equivalent for is absent rather than greyed \u2014
              boosting, insights, events, threads, privacy settings, per-server
              profiles and raid tools. "Mark as read" and "Hide muted channels"
              are absent for a different reason: both are real ideas Gryt could
              have, and neither exists yet, so there is nothing to wire a row to.

              Three rows went the other way. Edit, Share and "Add to new group"
              were `<ContextMenu.Item>` with no `onClick` \u2014 they have never done
              anything. A row that does nothing when pressed is worse than no
              row, so they are gone rather than reordered.
            */}
            <ContextMenu.Item onClick={() => openServerSettings(host, "invites")}>
              Invite to server
            </ContextMenu.Item>
            <ContextMenu.Separator />

            {/* The same three levels the channel list offers per channel and
                per folder, at the scope above them. Device-local, like those. */}
            <ContextMenu.SubmenuRoot>
              <ContextMenu.SubmenuTrigger>Notifications</ContextMenu.SubmenuTrigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner>
                  <ContextMenu.Popup>
                    {SERVER_NOTIFICATION_CHOICES.map((choice) => (
                      <ContextMenu.Item
                        key={choice.label}
                        onClick={() => setNotificationLevel(host, { kind: "server" }, choice.value)}
                      >
                        <span style={{ display: "inline-block", width: 16 }}>
                          {getOwnLevel(host, { kind: "server" }) === choice.value ? "\u2713" : ""}
                        </span>
                        {choice.label}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.SubmenuRoot>
            <ContextMenu.Separator />

            <ContextMenu.Item onClick={() => openServerSettings(host)}>
              Server settings
            </ContextMenu.Item>
            {canClaim(host) && (
              /* For a seed restored onto a device that has never been to this
                 server: nothing local knows there is a membership to claim, and
                 the server cannot be asked without proving the link, which is
                 the disclosure itself. Saying so by hand is the consent
                 (GRYT-285). */
              <ContextMenu.Item onClick={() => claim(host)}>
                I&rsquo;ve used this server before
              </ContextMenu.Item>
            )}
            {/* Offered whatever the connection state is, deliberately. A server
                that will not connect at all is the case somebody most needs
                this for, and hiding it there would leave them with nothing.
                GRYT-483. */}
            <ContextMenu.Item onClick={() => setDoctorOpen(true)}>
              Doctor
            </ContextMenu.Item>
            {duplicateHosts.length > 0 && (
              /* Offered, never done for you. Collapsing these deletes a rail
                 entry, and silent is friendlier right up until it removes the
                 one somebody actually uses. GRYT-317. */
              <ContextMenu.Item onClick={() => setMergeOpen(true)}>
                {duplicateHosts.length === 1
                  ? "Merge with the other entry\u2026"
                  : "Merge the other entries\u2026"}
              </ContextMenu.Item>
            )}
            <ContextMenu.Separator />
            <ContextMenu.Item
              className="text-gryt-danger"
              onClick={() => {
                setShowRemoveServer(host);
              }}
            >
              Leave server
            </ContextMenu.Item>
            <ContextMenu.Separator />
            {/* The address rather than an id: it is what identifies a Gryt
                server, and it is the thing worth pasting to somebody. */}
            <ContextMenu.Item onClick={() => copyServerAddress(host)}>
              Copy server address
            </ContextMenu.Item>
          </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        </ContextMenu.Root>
        <AlertDialog.Root open={mergeOpen} onOpenChange={setMergeOpen}>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Popup>
              <AlertDialog.Title>Merge into {host}?</AlertDialog.Title>
              <AlertDialog.Description>
                {duplicateHosts.length === 1
                  ? `${duplicateHosts[0]} is the same server as ${host}, reached at a different address.`
                  : `${duplicateHosts.join(", ")} are the same server as ${host}, reached at different addresses.`}{" "}
                Keeping {host} removes the{" "}
                {duplicateHosts.length === 1 ? "other entry" : "other entries"} from
                your list. You stay a member either way \u2014 this is your list, not
                the server. Your place in the list and the channel you were last in
                are kept.
              </AlertDialog.Description>
              <div className="flex gap-3 mt-4 justify-end">
                <AlertDialog.Close
                  render={
                    <Button tone="neutral" size="small">
                      Cancel
                    </Button>
                  }
                />
                <AlertDialog.Close
                  render={
                    <Button size="small"
                      onClick={() => {
                        mergeDuplicates(host);
                        setMergeOpen(false);
                      }}
                    >
                      Keep {host}
                    </Button>
                  }
                />
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
        <ServerDoctor
          host={host}
          serverName={servers[host]?.name || host}
          socketConnected={connectionStatus === "connected"}
          sfuHosts={
            serverDetailsList[host]?.sfu_hosts ??
            (serverDetailsList[host]?.sfu_host
              ? [serverDetailsList[host].sfu_host]
              : [])
          }
          stunHosts={serverDetailsList[host]?.stun_hosts ?? []}
          open={doctorOpen}
          onOpenChange={setDoctorOpen}
        />
        <PreviewCard.Portal>
          <PreviewCard.Positioner side="right" align="center">
            <PreviewCard.Popup>
          <div>
            <h2 className="text-xs">
              {servers[host].name}
              {isConnected && currentServerConnected === host && (
                <span style={{ color: "var(--gryt-accent-9)", marginLeft: "8px" }}>
                  • Connected to voice
                </span>
              )}
              {awaitingApproval && (
                <span style={{ color: "var(--gryt-warning-9)", marginLeft: "8px" }}>
                  • Requested access
                </span>
              )}
              {isUnavailable && !awaitingApproval && (
                <span style={{ color: "var(--gryt-danger-9)", marginLeft: "8px" }}>
                  • Offline
                </span>
              )}
              {isReconnecting && (
                <span style={{ color: "var(--gryt-warning-9)", marginLeft: "8px" }}>
                  • Reconnecting
                </span>
              )}
              {/* Named for what it is rather than for the state machine.
                  "Starting your server" is the only one of these you caused,
                  and it is the only one that is going to work. */}
              {isStarting && (
                <span style={{ color: "var(--gryt-accent-9)", marginLeft: "8px" }}>
                  • Starting your server
                </span>
              )}
              {isSettling && (
                <span style={{ color: "var(--gryt-neutral-11)", marginLeft: "8px" }}>
                  • No answer yet
                </span>
              )}
              {isConnecting && !isSettling && !isStarting && (
                <span style={{ color: "var(--gryt-warning-9)", marginLeft: "8px" }}>
                  • Connecting
                </span>
              )}
            </h2>
            <span className="text-xs text-gryt-muted">{host}</span>
            {duplicateHosts.length > 0 && (
              /* Making the duplicate legible even for somebody who never
                 merges it. Two entries with the same name and icon are
                 otherwise indistinguishable on the rail. */
              <div className="text-xs" style={{ color: "var(--gryt-warning-11)", marginTop: 4 }}>
                Also in your list as {duplicateHosts.join(", ")}
              </div>
            )}
          </div>
        </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </Reorder.Item>
  );
}
