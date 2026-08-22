import { IconButton } from "@gryt/ui";
import type { StreamSources } from "@gryt/voice";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState } from "react";
import { PiList, PiPhoneCallFill, PiUsersFill } from "react-icons/pi";

import type { Channel, SidebarItem } from "@/settings/src/types/server";

import type { PeerLatencyStats } from "../hooks/usePeerLatency";
import type { Client } from "../types/clients";
import { ChannelList } from "./ChannelList";
import type { ChatMessage } from "./chatUtils";
import { ChatView } from "./ChatView";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { MemberSidebar } from "./MemberSidebar";
import { MobileSheet } from "./MobileSheet";
import { ServerHeader } from "./ServerHeader";
import { VoiceView } from "./VoiceView";

/** A role id. The server defines its own; these only pass one along. */
type Role = string;

interface MobileServerViewProps {
  serverName?: string;
  serverRole?: Role;
  isServerUnreachable: boolean;
  isConnectedToVoiceOnThisServer: boolean;

  // ServerHeader
  onOpenSettings: () => void;
  onOpenReports: () => void;
  pendingReportCount: number;
  updateAvailable: boolean;
  onLeave: () => void;

  // ChannelList
  channels: Channel[];
  sidebarItems: SidebarItem[];
  serverHost: string;
  clients: Record<string, Client>;
  members: MemberInfo[];
  currentChannelId?: string;
  currentServerConnected: string | null;
  showVoiceView: boolean;
  isConnecting: boolean;
  currentConnectionId?: string;
  selectedChannelId: string | null;
  onChannelClick: (channel: Channel) => void;
  clientsSpeaking: Record<string, boolean>;
  canManage: boolean;
  onEditItem: (item: SidebarItem) => void;
  onDeleteItem: (item: SidebarItem) => void;
  onMoveItem: (item: SidebarItem, direction: "up" | "down") => void;
  onReorder: (ids: string[]) => void;
  onAddItem: (kind: string) => void;
  onDisconnectUser?: (targetServerUserId: string) => void;
  currentUserRole?: Role;
  adminActions?: AdminActions;
  unreadChannelIds?: Set<string>;

  // ChatView
  chatMessages: ChatMessage[];
  canSend: boolean;
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage?: (messageId: string, conversationId: string, newText: string) => void;
  currentUserId?: string;
  channelName?: string;
  channelType?: "text" | "voice";
  currentUserNickname?: string;
  socketConnection?: unknown;
  memberList: Record<string, MemberInfo>;
  isRateLimited?: boolean;
  rateLimitCountdown?: number;
  canViewVoiceChannelText?: boolean;
  isVoiceChannelTextChat?: boolean;
  isLoadingMessages?: boolean;
  restoreText?: string | null;
  clearRestoreText?: () => void;
  canDeleteAny?: boolean;
  maxFileSize?: number | null;
  onLoadOlder?: () => void;
  isLoadingOlder?: boolean;
  hasOlderMessages?: boolean;
  // VoiceView
  voiceWidth: string;
  clientsForHost: Record<string, Client>;
  onVoiceDisconnect?: () => void;
  peerLatency?: Record<string, PeerLatencyStats>;
  videoStreams?: Record<string, MediaStream>;
  streamSources?: StreamSources;
}

export const MobileServerView = (props: MobileServerViewProps) => {
  const { onChannelClick } = props;
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const handleChannelClick = useCallback(
    (channel: Channel) => {
      onChannelClick(channel);
      setChannelsOpen(false);
    },
    [onChannelClick],
  );

  return (
    <div className="flex flex-col" style={{ flex: 1, overflow: "hidden" }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2" style={{
          flexShrink: 0,
          borderBottom: "1px solid var(--gryt-neutral-a5)",
          background: "var(--gryt-neutral-1)",
          gap: 8,
        }}>
        <IconButton tone="ghost" size="xsmall"
          onClick={() => setChannelsOpen(true)}
          aria-label="Open channels"
        >
          <PiList size={22} />
        </IconButton>

        <span className="text-sm font-medium" style={{
            flex: 1,
            textAlign: "center",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
          {props.channelName ?? props.serverName ?? ""}
        </span>

        <IconButton tone="ghost" size="xsmall"
          onClick={() => setMembersOpen(true)}
          aria-label="Open members"
        >
          <PiUsersFill size={22} />
        </IconButton>
      </div>

      {/* Chat (main content) */}
      <div
        style={{
          flex: 1,
          display: "flex",
          minHeight: 0,
          ...(props.isServerUnreachable && !props.isConnectedToVoiceOnThisServer && {
            opacity: 0.5,
            pointerEvents: "none" as const,
          }),
          transition: "opacity 0.3s ease",
        }}
      >
        <ChatView
          chatMessages={props.chatMessages}
          conversationKey={props.selectedChannelId ?? undefined}
          canSend={props.canSend}
          sendChat={props.sendChat}
          editMessage={props.editMessage}
          currentUserId={props.currentUserId}
          channelName={props.channelName}
          channelType={props.channelType}
          currentUserNickname={props.currentUserNickname}
          socketConnection={props.socketConnection}
          serverHost={props.serverHost}
          memberList={props.memberList}
          isRateLimited={props.isRateLimited}
          rateLimitCountdown={props.rateLimitCountdown}
          canViewVoiceChannelText={props.canViewVoiceChannelText}
          isVoiceChannelTextChat={props.isVoiceChannelTextChat}
          restoreText={props.restoreText}
          clearRestoreText={props.clearRestoreText}
          canDeleteAny={props.canDeleteAny}
          maxFileSize={props.maxFileSize}
          onLoadOlder={props.onLoadOlder}
          isLoadingOlder={props.isLoadingOlder}
          hasOlderMessages={props.hasOlderMessages}
          {...(props.isLoadingMessages !== undefined && { isLoadingMessages: props.isLoadingMessages })}
        />
      </div>

      {/* Floating voice button */}
      <AnimatePresence>
        {props.isConnectedToVoiceOnThisServer && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 24 }}
            style={{
              position: "fixed",
              bottom: 80,
              right: 16,
              zIndex: "var(--gryt-z-sheet)",
            }}
          >
            <IconButton size="large"
              onClick={() => setVoiceOpen(true)}
              style={{
                width: 56,
                height: 56,
                boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
              }}
            >
              <PiPhoneCallFill size={26} />
            </IconButton>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Channels sheet (left) */}
      <MobileSheet open={channelsOpen} onClose={() => setChannelsOpen(false)} side="left">
        <div className="flex flex-col" style={{ height: "100%", overflow: "hidden" }}>
          <div className="p-3" style={{ flexShrink: 0 }}>
            <ServerHeader
              serverName={props.serverName}
              role={props.serverRole}
              onOpenSettings={props.onOpenSettings}
              onOpenReports={props.onOpenReports}
              pendingReportCount={props.pendingReportCount}
              updateAvailable={props.updateAvailable}
              onLeave={props.onLeave}
            />
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
            <ChannelList
              channels={props.channels}
              items={props.sidebarItems}
              serverHost={props.serverHost}
              clients={props.clients}
              members={props.members}
              currentChannelId={props.currentChannelId ?? ""}
              currentServerConnected={props.currentServerConnected}
              showVoiceView={props.showVoiceView}
              isConnecting={props.isConnecting}
              currentConnectionId={props.currentConnectionId}
              selectedChannelId={props.selectedChannelId}
              onChannelClick={handleChannelClick}
              clientsSpeaking={props.clientsSpeaking}
              streamSources={props.streamSources}
              canManage={props.canManage}
              onEditItem={props.onEditItem}
              onDeleteItem={props.onDeleteItem}
              onMoveItem={props.onMoveItem}
              onReorder={props.onReorder}
              onAddItem={props.onAddItem}
              onDisconnectUser={props.canManage ? props.onDisconnectUser : undefined}
              currentUserRole={props.currentUserRole}
              adminActions={props.adminActions}
              unreadChannelIds={props.unreadChannelIds}
            />
          </div>
        </div>
      </MobileSheet>

      {/* Members sheet (right) */}
      <MobileSheet open={membersOpen} onClose={() => setMembersOpen(false)} side="right">
        <div style={{ height: "100%", overflow: "hidden" }}>
          <MemberSidebar
            members={props.members}
            currentConnectionId={props.currentConnectionId}
            currentServerUserId={props.currentUserId}
            currentUserRole={props.currentUserRole}
            currentServerConnected={props.currentServerConnected}
            serverHost={props.serverHost}
            adminActions={props.adminActions}
          />
        </div>
      </MobileSheet>

      {/* Voice sheet (bottom) */}
      <MobileSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} side="bottom">
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          <VoiceView
            showVoiceView
            voiceWidth="100%"
            serverHost={props.serverHost}
            currentServerConnected={props.currentServerConnected}
            currentChannelId={props.currentChannelId}
            clientsForHost={props.clientsForHost}
            members={props.members}
            clientsSpeaking={props.clientsSpeaking}
            isConnecting={props.isConnecting}
            currentConnectionId={props.currentConnectionId}
            onDisconnect={props.onVoiceDisconnect}
            peerLatency={props.peerLatency}
            onDisconnectUser={props.canManage ? props.onDisconnectUser : undefined}
            currentUserRole={props.currentUserRole}
            adminActions={props.adminActions}
            videoStreams={props.videoStreams}
            streamSources={props.streamSources}
          />
        </div>
      </MobileSheet>
    </div>
  );
};
