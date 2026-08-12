import {
  Avatar,
  Box,
  Button,
  ContextMenu,
  DropdownMenu,
  Flex,
  Heading,
  HoverCard,
  IconButton,
  Tooltip,
} from "@radix-ui/themes";
import { Reorder } from "motion/react";
import { PiBugFill, PiChatCircleDotsFill, PiGearFill, PiMicrophoneFill, PiPlus, PiSignInFill } from "react-icons/pi";

import {
  GeneratedServerIcon,
  generatedServerIconUrl,
  getServerHttpBase,
  resolveAvatarSrc,
  useAccount,
  useUnreadTracker,
} from "@/common";
import { useSettings } from "@/settings";
import {
  Server,
  serverDetailsList as ServerDetailsListType,
  Servers,
} from "@/settings/src/types/server";
import { useServerManagement, useSockets } from "@/socket";
import { useSFU } from "@/webRTC";
import { MiniControls } from "@/webRTC/src/components/miniControls";

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
  serverDetailsList: ServerDetailsListType,
): string {
  const info = serverDetailsList[host]?.server_info;
  if (info?.icon_url) {
    return `${getServerHttpBase(host)}/icon?v=${encodeURIComponent(info.icon_url)}`;
  }
  if (info) return generatedServerIconUrl(host);
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
  } = useServerManagement();

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
    <Flex
      data-gryt="sidebar"
      direction="column"
      height="100%"
      gap="4"
      align="center"
      justify="between"
    >
      <Flex direction="column" gap="4" pt="2">
        <Reorder.Group
          axis="y"
          values={orderedServerHosts}
          onReorder={reorderServers}
          as="div"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-4)",
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
              currentlyViewingServer={currentlyViewingServer}
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
        <Tooltip content="Add new server" delayDuration={100} side="right">
          <IconButton
            data-tour="add-server"
            variant="soft"
            color="gray"
            onClick={() => setShowAddServer(true)}
          >
            <PiPlus size={16} />
          </IconButton>
        </Tooltip>
      </Flex>

      <Flex justify="center" align="center" direction="column" gap="3" pb="3">
        {/* Voice chat controls */}
        <MiniControls direction="column" />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton data-tour="profile">
              <Avatar
                fallback={displayNickname[0]}
                src={displayAvatarUrl || undefined}
              />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item onClick={() => setShowSettings(true)}>
              <Flex align="center" gap="1">
                <PiGearFill size={14} />
                Settings
              </Flex>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              onClick={() =>
                window.open("https://feedback.gryt.chat", "_blank")
              }
            >
              <Flex align="center" gap="1">
                <PiChatCircleDotsFill size={14} />
                Give feedback
              </Flex>
            </DropdownMenu.Item>
            {/* Kept separate from feedback rather than folded into it. "Give
                feedback" is a suggestion box; this is for when something is
                broken, and it arrives as an issue carrying the version and
                platform, which a free-text form does not. */}
            <DropdownMenu.Item
              onClick={() => window.open(bugReportUrl(), "_blank")}
            >
              <Flex align="center" gap="1">
                <PiBugFill size={14} />
                Report a bug
              </Flex>
            </DropdownMenu.Item>
            {/* Guest-by-default (GRYT-173) means most people on a first run
                have no account, and offering them a way out of one they never
                had is both wrong and a wasted invitation. `isSignedIn` is
                undefined until Keycloak answers, so neither item is shown
                until it does — a control that changes label a beat after you
                open the menu is worse than one that arrives a beat late. */}
            {isSignedIn !== undefined && (
              <>
                <DropdownMenu.Separator />
                {isSignedIn ? (
                  <DropdownMenu.Item color="red" onClick={logout}>
                    Sign out
                  </DropdownMenu.Item>
                ) : (
                  <DropdownMenu.Item onClick={login}>
                    <Flex align="center" gap="1">
                      <PiSignInFill size={14} />
                      Sign in
                    </Flex>
                  </DropdownMenu.Item>
                )}
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Flex>
    </Flex>
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
  const connectionStatus = serverConnectionStatus[host] || "disconnected";
  const isOffline = connectionStatus === "disconnected";
  const isConnecting = connectionStatus === "connecting";
  const isReconnecting = connectionStatus === "reconnecting";
  const isUnavailable = isOffline && !isConnecting;

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
        borderRadius: "var(--radius-2)",
      }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <HoverCard.Root openDelay={500} closeDelay={0}>
        <ContextMenu.Root>
          <ContextMenu.Trigger>
            <HoverCard.Trigger>
              <Box position="relative" onDragStart={(e) => e.preventDefault()}>
                <Avatar
                  size="2"
                  color="gray"
                  asChild
                  fallback={<GeneratedServerIcon host={host} />}
                  style={{
                    opacity:
                      currentlyViewingServer?.host === host
                        ? 1
                        : isUnavailable
                        ? 0.3
                        : isReconnecting
                        ? undefined
                        : 0.5,
                    filter:
                      isUnavailable || isReconnecting
                        ? "grayscale(100%)"
                        : "none",
                    animation: isReconnecting
                      ? "pulse-reconnect 1.5s ease-in-out infinite"
                      : "none",
                  }}
                  src={serverIconSrc(host, serverDetailsList)}
                >
                  <Button
                    style={{
                      padding: "0",
                      cursor: isUnavailable ? "not-allowed" : "pointer",
                    }}
                    onClick={() => {
                      if (!isUnavailable) {
                        switchToServer(host);
                      }
                    }}
                  ></Button>
                </Avatar>

                {isConnected && currentServerConnected === host && (
                  <Box
                    position="absolute"
                    top="-2px"
                    right="-2px"
                    style={{
                      width: "16px",
                      height: "16px",
                      borderRadius: "50%",
                      backgroundColor: "var(--accent-9)",
                      border: "2px solid var(--color-background)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 1,
                    }}
                  >
                    <PiMicrophoneFill size={8} color="var(--accent-contrast)" />
                  </Box>
                )}
                {serverHasUnread(host) && (
                  <Box
                    position="absolute"
                    bottom="-2px"
                    right="-2px"
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      backgroundColor: "var(--accent-9)",
                      border: "2px solid var(--color-background)",
                      zIndex: 1,
                      pointerEvents: "none",
                    }}
                  />
                )}
              </Box>
            </HoverCard.Trigger>
          </ContextMenu.Trigger>
          <ContextMenu.Content>
            <ContextMenu.Label style={{ fontWeight: "bold" }}>
              {servers[host].name}
            </ContextMenu.Label>
            <ContextMenu.Item>Edit</ContextMenu.Item>
            <ContextMenu.Item>Share</ContextMenu.Item>
            <ContextMenu.Item>Add to new group</ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Item
              color="red"
              onClick={() => {
                setShowRemoveServer(host);
              }}
            >
              Leave
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Root>
        <HoverCard.Content
          maxWidth="300px"
          side="right"
          size="1"
          align="center"
        >
          <Box>
            <Heading size="1">
              {servers[host].name}
              {isConnected && currentServerConnected === host && (
                <span style={{ color: "var(--accent-9)", marginLeft: "8px" }}>
                  • Connected to voice
                </span>
              )}
              {isUnavailable && (
                <span style={{ color: "var(--red-9)", marginLeft: "8px" }}>
                  • OFFLINE
                </span>
              )}
              {isReconnecting && (
                <span style={{ color: "var(--orange-9)", marginLeft: "8px" }}>
                  • Reconnecting...
                </span>
              )}
              {isConnecting && (
                <span style={{ color: "var(--orange-9)", marginLeft: "8px" }}>
                  • Connecting...
                </span>
              )}
            </Heading>
          </Box>
        </HoverCard.Content>
      </HoverCard.Root>
    </Reorder.Item>
  );
}
