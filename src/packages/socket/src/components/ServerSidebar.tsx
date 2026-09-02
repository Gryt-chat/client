import type { StreamSources } from "@gryt/voice";
import { motion } from "motion/react";
import { RefObject } from "react";

import type { Channel, SidebarItem } from "@/settings/src/types/server";

import type { DirectConversation } from "../hooks/useDirectMessages";
import type { Client } from "../types/clients";
import { ChannelList } from "./ChannelList";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { ServerHeader } from "./ServerHeader";

/** A role id. The server defines its own; these only pass one along. */
type Role = string;

const SIDEBAR_SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };

interface ServerSidebarProps {
  sidebarOpen: boolean;
  sidebarWidthPx: number;
  hoverPx: number;
  contentRef: RefObject<HTMLDivElement | null>;
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
  streamSources?: StreamSources;
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
  mentionCounts?: Map<string, number>;
  directConversations?: DirectConversation[];
  selectedDmId?: string | null;
  onSelectDm?: (conversation: DirectConversation) => void;
  onHideDm?: (conversation: DirectConversation) => void;
  /** Open the settings for a group. Absent means no group management. */
  onManageGroup?: (conversation: DirectConversation) => void;
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
  onChannelClick, clientsSpeaking, streamSources,
  canManage, onEditItem, onDeleteItem, onMoveItem, onReorder, onAddItem,
  onDisconnectUser, currentUserRole, adminActions, unreadChannelIds, mentionCounts,
  directConversations, selectedDmId, onSelectDm, onHideDm, onManageGroup,
}: ServerSidebarProps) => (
  <div
    role="navigation"
    aria-label="Channels"
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
          // Hold this width while the parent animates to 0. Without it the
          // flex default lets this shrink with its container, so closing the
          // sidebar reflows and wraps everything on the way out instead of
          // sliding it behind the edge. Measured: 240 -> 160 -> 104 as the
          // container narrows, 104 being the min-content width of the text.
          flexShrink: 0,
          height: "100%",
          display: "flex",
          pointerEvents: sidebarOpen ? "auto" : "none",
        }}
      >
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <div className="flex flex-col h-full w-full items-center gap-4">
            <ServerHeader
              serverName={serverName}
              role={serverRole}
              pinned={pinned}
              onTogglePinned={onTogglePinned}
              onCreateChannel={() => onAddItem("channel:text")}
              onOpenSettings={onOpenSettings}
              onOpenReports={onOpenReports}
              pendingReportCount={pendingReportCount}
              updateAvailable={updateAvailable}
              onLeave={onLeave}
            />
            {/*
              Room for the rows to grow into.

              Buttons scale to 1.03 on hover, and authoring only overflowY is
              not the same as leaving the other axis alone: when one axis is not
              visible, CSS computes the other from visible to auto. So this was
              a horizontal scrollport too, and a 240px row grew 3.6px past each
              edge and was cut off. The first row lost 0.5px off its top for the
              same reason.

              Padding, and no negative margin to claw the width back. The
              obvious version of this fix bleeds outward with margin-inline and
              a calc width, which keeps the rows at their old width, but the
              motion.div above animates the sidebar open with overflow hidden,
              so the bleed is clipped by the thing that makes that animation
              work. The rows are 12px narrower now, sitting in a 6px gutter,
              and that is the trade.
            */}
            <div style={{
              flex: 1,
              width: "100%",
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              padding: "2px 6px",
            }}>
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
                streamSources={streamSources}
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
                mentionCounts={mentionCounts}
                directConversations={directConversations}
                selectedDmId={selectedDmId}
                onSelectDm={onSelectDm}
                onHideDm={onHideDm}
                onManageGroup={onManageGroup}
              />
            </div>
          </div>
        </div>
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
          background: "var(--gryt-neutral-a4)",
          opacity: 0.5,
          transition: "background 0.15s",
        }}
      />
    </motion.div>
  </div>
);
