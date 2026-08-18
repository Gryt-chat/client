import { Avatar, ContextMenu, IconButton, Menu, PreviewCard, Tooltip } from "@gryt/ui";
import { Reorder } from "motion/react";
import { PiBroadcastFill, PiBugFill, PiChatCircleDotsFill, PiGearFill, PiMicrophoneFill, PiPlus, PiSignInFill } from "react-icons/pi";

import {
  GeneratedServerIcon,
  generatedServerIconUrl,
  getServerHttpBase,
  resolveAvatarSrc,
  useAccount,
  useUnreadTracker,
} from "@/common";
import { useSettings } from "@/settings";
import { useLanDiscovery } from "@/settings/src/hooks/useLanDiscovery";
import {
  Server,
  serverDetailsList as ServerDetailsListType,
  Servers,
} from "@/settings/src/types/server";
import { useServerManagement, useSockets } from "@/socket";
import { useSFU } from "@/webRTC";
import { MiniControls } from "@/webRTC/src/components/miniControls";

import { useIdentityClaim } from "../hooks/useIdentityClaim";
import { bugReportUrl } from "../lib/bugReport";


/**
 * Where to point a server's icon.
 *
 * Three cases, and the middle one is the reason this is a function. Once the
 * server has told us it has no icon, asking for one anyway means the browser
 * can answer from cache — and clearing an icon then leaves the old one on
 * screen until that entry expires, which reads as the server still serving it.
 * Knowing there is none, we draw the generated one and make no request at all.
 *
 * Before details arrive we do not know either way, so we ask and let the
 * Avatar's fallback handle a 404.
 */
function serverIconSrc(
  host: string,
  name: string,
  serverDetailsList: ServerDetailsListType,
): string {
  const info = serverDetailsList[host]?.server_info;
  if (info?.icon_url) {
    return `${getServerHttpBase(host)}/icon?v=${encodeURIComponent(info.icon_url)}`;
  }
  // The server's own name first: it is the one the server reports, so a rename
  // reaches the rail as soon as details refresh. The locally stored name is
  // what we had before it answered.
  if (info) return generatedServerIconUrl(info.name || name || host);
  return `${getServerHttpBase(host)}/icon`;
}

interface SidebarProps {
  setShowAddServer: (show: boolean) => void;
}

export function Sidebar({ setShowAddServer }: SidebarProps) {
  const { isSignedIn, login, logout } = useAccount();
  const { nickname, avatarDataUrl, setShowSettings } = useSettings();

  const {
    servers,
    currentlyViewingServer,
    setShowRemoveServer,
    switchToServer,
    orderedServerHosts,
    reorderServers,
    showDiscovery,
    setShowDiscovery,
    newLanServers,
  } = useServerManagement();
  const { isElectron } = useLanDiscovery();

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
            <Menu.Item
              onClick={() =>
                window.open("https://feedback.gryt.chat", "_blank")
              }
            >
              <div className="flex items-center gap-1">
                <PiChatCircleDotsFill size={14} />
                Give feedback
              </div>
            </Menu.Item>
            {/* Kept separate from feedback rather than folded into it. "Give
                feedback" is a suggestion box; this is for when something is
                broken, and it arrives as an issue carrying the version and
                platform, which a free-text form does not. */}
            <Menu.Item
              onClick={() => window.open(bugReportUrl(), "_blank")}
            >
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
}

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
}: ServerItemProps) {
  const { canClaim, claim } = useIdentityClaim();
  const connectionStatus = serverConnectionStatus[host] || "disconnected";
  const isOffline = connectionStatus === "disconnected";
  const isConnecting = connectionStatus === "connecting";
  const isReconnecting = connectionStatus === "reconnecting";
  const isUnavailable = isOffline && !isConnecting;
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
                    opacity:
                      currentlyViewingServer?.host === host
                        ? 1
                        : isUnavailable
                        ? 0.3
                        : awaitingApproval
                        ? 0.4
                        : isReconnecting
                        ? undefined
                        : 0.5,
                    filter:
                      isUnavailable || isReconnecting || awaitingApproval
                        ? "grayscale(100%)"
                        : "none",
                    animation: isReconnecting
                      ? "pulse-reconnect 1.5s ease-in-out infinite"
                      : "none",
                  }}
                  src={serverIconSrc(host, servers[host]?.name || "", serverDetailsList)}
                />

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
            <ContextMenu.Item>Edit</ContextMenu.Item>
            <ContextMenu.Item>Share</ContextMenu.Item>
            <ContextMenu.Item>Add to new group</ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              onClick={() => {
                setShowRemoveServer(host);
              }}
            >
              Leave
            </ContextMenu.Item>
          </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        </ContextMenu.Root>
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
                  • OFFLINE
                </span>
              )}
              {isReconnecting && (
                <span style={{ color: "var(--gryt-warning-9)", marginLeft: "8px" }}>
                  • Reconnecting...
                </span>
              )}
              {isConnecting && (
                <span style={{ color: "var(--gryt-warning-9)", marginLeft: "8px" }}>
                  • Connecting...
                </span>
              )}
            </h2>
          </div>
        </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </Reorder.Item>
  );
}
