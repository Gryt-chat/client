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
import { MdAdd, MdFeedback, MdMic, MdSettings } from "react-icons/md";

import { useAccount, useUnreadTracker } from "@/common";
import { useSettings } from "@/settings";
import {
  Server,
  serverDetailsList as ServerDetailsListType,
  Servers,
} from "@/settings/src/types/server";
import { useServerManagement, useSockets } from "@/socket";
import { useSFU } from "@/webRTC";
import { MiniControls } from "@/webRTC/src/components/miniControls";

import { LanServerItem } from "./lanServerItem";

interface SidebarProps {
  setShowAddServer: (show: boolean) => void;
}

export function Sidebar({ setShowAddServer }: SidebarProps) {
  const { logout } = useAccount();
  const {
    nickname,
    avatarDataUrl,
    setShowSettings,
  } = useSettings();
  
  const {
    servers,
    currentlyViewingServer,
    setShowRemoveServer,
    switchToServer,
    orderedServerHosts,
    reorderServers,
    pendingLanServers,
  } = useServerManagement();
  

  const { currentServerConnected, isConnected } = useSFU();
  const { serverConnectionStatus, serverProfiles, serverDetailsList } = useSockets();
  const { serverHasUnread } = useUnreadTracker();

  const currentHost = currentlyViewingServer?.host;
  const activeProfile = currentHost ? serverProfiles[currentHost] : undefined;
  const displayNickname = activeProfile?.nickname || nickname;
  const displayAvatarUrl = activeProfile?.avatarUrl || avatarDataUrl;
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
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", listStyle: "none", padding: 0, margin: 0 }}
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
        {pendingLanServers.map((s) => (
          <LanServerItem key={`${s.host}:${s.port}`} server={s} />
        ))}
        <Tooltip content="Add new server" delayDuration={100} side="right">
          <IconButton
            variant="soft"
            color="gray"
            onClick={() => setShowAddServer(true)}
          >
            <MdAdd size={16} />
          </IconButton>
        </Tooltip>
      </Flex>

      <Flex justify="center" align="center" direction="column" gap="3" pb="3">
        {/* Voice chat controls */}
        <MiniControls direction="column" />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton>
              <Avatar fallback={displayNickname[0]} src={displayAvatarUrl || undefined} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item onClick={() => setShowSettings(true)}>
              <Flex align="center" gap="1">
                <MdSettings size={14} />
                Settings
              </Flex>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item
              onClick={() => window.open("https://feedback.gryt.chat", "_blank")}
            >
              <Flex align="center" gap="1">
                <MdFeedback size={14} />
                Give feedback
              </Flex>
            </DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item color="red" onClick={logout}>
              Sign out
            </DropdownMenu.Item>
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
      whileDrag={{ scale: 1.1, boxShadow: "0 4px 12px rgba(0,0,0,0.3)", zIndex: 10, cursor: "grabbing", borderRadius: "var(--radius-2)" }}
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
                  fallback={servers[host].name[0]}
                  style={{
                    opacity: currentlyViewingServer?.host === host ? 1 : (isUnavailable ? 0.3 : (isReconnecting ? undefined : 0.5)),
                    filter: (isUnavailable || isReconnecting) ? "grayscale(100%)" : "none",
                    animation: isReconnecting ? "pulse-reconnect 1.5s ease-in-out infinite" : "none",
                  }}
                  src={`https://${host}/icon${serverDetailsList[host]?.server_info?.icon_url ? `?v=${encodeURIComponent(serverDetailsList[host].server_info!.icon_url!)}` : ""}`}
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
                    <MdMic size={8} color="var(--accent-contrast)" />
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
