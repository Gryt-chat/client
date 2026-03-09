import { Box, Flex } from "@radix-ui/themes";
import { motion } from "motion/react";
import { RefObject } from "react";

import type { Channel, SidebarItem } from "@/settings/src/types/server";

import type { Client } from "../types/clients";
import { ChannelList } from "./ChannelList";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { ServerHeader } from "./ServerHeader";

type Role = "owner" | "admin" | "mod" | "member";

const SIDEBAR_SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };

interface ServerSidebarProps {
  sidebarOpen: boolean;
  sidebarWidthPx: number;
  hoverPx: number;
  contentRef: RefObject<HTMLDivElement>;
  isUnreachableWhileConnected: boolean;
  onMouseEnter?: () => void;
  onMouseLeave: () => void;
  serverName: string | undefined;
  serverRole: Role | undefined;
  pinned: boolean;
  onTogglePinned: () => void;
  onOpenSettings: () => void;
  onOpenReports: () => void;
  pendingReportCount: number;
  updateAvailable: boolean;
  onLeave: () => void;
  channels: Channel[];
  sidebarItems: SidebarItem[];
  serverHost: string;
  clients: Record<string, Client>;
  members: MemberInfo[];
  currentChannelId: string;
  currentServerConnected: string | null;
  showVoiceView: boolean;
  isConnecting: boolean;
  currentConnectionId: string | undefined;
  selectedChannelId: string | null;
  onChannelClick: (channel: Channel) => void;
  clientsSpeaking: Record<string, boolean>;
  canManage: boolean;
  onEditItem: (item: SidebarItem) => void;
  onDeleteItem: (item: SidebarItem) => void;
  onMoveItem: (item: SidebarItem, direction: "up" | "down") => void;
  onReorder: (ids: string[]) => void;
  onAddItem: (kind: string) => void;
  onDisconnectUser: ((id: string) => void) | undefined;
  currentUserRole: Role | undefined;
  adminActions: AdminActions | undefined;
  unreadChannelIds?: Set<string>;
}

export const ServerSidebar = ({
  sidebarOpen, sidebarWidthPx, hoverPx, contentRef,
  isUnreachableWhileConnected,
  onMouseEnter, onMouseLeave,
  serverName, serverRole, pinned, onTogglePinned,
  onOpenSettings, onOpenReports, pendingReportCount, updateAvailable, onLeave,
  channels, sidebarItems, serverHost, clients, members,
  currentChannelId, currentServerConnected, showVoiceView,
  isConnecting, currentConnectionId, selectedChannelId,
  onChannelClick, clientsSpeaking,
  canManage, onEditItem, onDeleteItem, onMoveItem, onReorder, onAddItem,
  onDisconnectUser, currentUserRole, adminActions, unreadChannelIds,
}: ServerSidebarProps) => (
  <div
    onMouseLeave={onMouseLeave}
    onMouseEnter={onMouseEnter}
    style={{ flexShrink: 0, display: "flex" }}
  >
    <motion.div
      animate={{ width: sidebarOpen ? sidebarWidthPx : 0 }}
      initial={false}
      transition={SIDEBAR_SPRING}
      style={{
        overflow: "hidden",
        display: "flex",
        justifyContent: "flex-start",
        ...(isUnreachableWhileConnected && {
          opacity: 0.5,
          pointerEvents: "none" as const,
        }),
        transition: "opacity 0.3s ease",
      }}
    >
      <div
        ref={contentRef}
        aria-hidden={!sidebarOpen}
        style={{
          width: sidebarWidthPx,
          height: "100%",
          display: "flex",
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
      >
        <Box
          width="240px"
          style={{ position: "relative", width: "100%", height: "100%" }}
        >
          <Flex direction="column" height="100%" width="100%" align="center" gap="4">
            <ServerHeader
              serverName={serverName}
              role={serverRole}
              pinned={pinned}
              onTogglePinned={onTogglePinned}
              onOpenSettings={onOpenSettings}
              onOpenReports={onOpenReports}
              pendingReportCount={pendingReportCount}
              updateAvailable={updateAvailable}
              onLeave={onLeave}
            />
            <Box style={{ flex: 1, width: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
              <ChannelList
                channels={channels}
                items={sidebarItems}
                serverHost={serverHost}
                clients={clients}
                members={members}
                currentChannelId={currentChannelId}
                currentServerConnected={currentServerConnected}
                showVoiceView={showVoiceView}
                isConnecting={isConnecting}
                currentConnectionId={currentConnectionId}
                selectedChannelId={selectedChannelId}
                onChannelClick={onChannelClick}
                clientsSpeaking={clientsSpeaking}
                canManage={canManage}
                onEditItem={onEditItem}
                onDeleteItem={onDeleteItem}
                onMoveItem={onMoveItem}
                onReorder={onReorder}
                onAddItem={onAddItem}
                onDisconnectUser={onDisconnectUser}
                currentUserRole={currentUserRole}
                adminActions={adminActions}
                unreadChannelIds={unreadChannelIds}
              />
            </Box>
          </Flex>
        </Box>
      </div>
    </motion.div>

    <motion.div
      animate={{ width: sidebarOpen ? 0 : hoverPx }}
      initial={false}
      transition={SIDEBAR_SPRING}
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: 4,
          height: "33%",
          borderRadius: 9999,
          background: "var(--gray-a4)",
          opacity: 0.5,
          transition: "background 0.15s",
        }}
      />
    </motion.div>
  </div>
);
