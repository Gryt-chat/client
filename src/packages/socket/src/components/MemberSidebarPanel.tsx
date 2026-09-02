import { motion } from "motion/react";
import { RefObject } from "react";

import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { MemberSidebar } from "./MemberSidebar";

/** A role id. The server defines its own; these only pass one along. */
type Role = string;

const SIDEBAR_SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };

interface MemberSidebarPanelProps {
  sidebarOpen: boolean;
  sidebarWidthPx: number;
  hoverPx: number;
  contentRef: RefObject<HTMLDivElement | null>;
  isUnreachableWhileConnected: boolean;
  onMouseEnter?: () => void;
  onMouseLeave: () => void;
  members: MemberInfo[];
  currentConnectionId: string | undefined;
  currentServerUserId: string | undefined;
  currentUserRole: Role | undefined;
  currentServerConnected: string | null;
  serverHost: string;
  adminActions: AdminActions | undefined;
  onOpenDm?: (targetServerUserId: string) => void;
  onToggleBlock?: (targetServerUserId: string) => void;
  onReport?: (target: { serverUserId: string; nickname: string }) => void;
  isBlocked?: (serverUserId: string) => boolean;
  pinned: boolean;
  onTogglePinned: () => void;
}

export const MemberSidebarPanel = ({
  sidebarOpen, sidebarWidthPx, hoverPx, contentRef,
  isUnreachableWhileConnected,
  onMouseEnter, onMouseLeave,
  members, currentConnectionId, currentServerUserId,
  currentUserRole,
  currentServerConnected, serverHost,
  adminActions, onOpenDm, onToggleBlock, isBlocked, onReport, pinned, onTogglePinned,
}: MemberSidebarPanelProps) => (
  <div
    // Named the way the other panels are, so a layout check can measure it.
    // The member list is the one that used to leave the window, and "is it
    // inside" was not a question anything could ask without this.
    data-gryt="member-sidebar"
    data-open={sidebarOpen || undefined}
    onMouseLeave={onMouseLeave}
    onMouseEnter={onMouseEnter}
    style={{ flexShrink: 0, display: "flex" }}
  >
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

    <motion.div
      animate={{ width: sidebarOpen ? sidebarWidthPx : 0 }}
      initial={false}
      transition={SIDEBAR_SPRING}
      style={{
        overflow: "hidden",
        display: "flex",
        justifyContent: "flex-end",
        ...(isUnreachableWhileConnected && {
          opacity: 0.5,
          pointerEvents: "none" as const,
        }),
        transition: "opacity 0.3s ease",
      }}
    >
      <div
        style={{
          width: sidebarWidthPx,
          // See the note in ServerSidebar: this holds its width so the parent's
          // overflow hidden clips it, rather than flex compressing it.
          flexShrink: 0,
          height: "100%",
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <div
          ref={contentRef}
          aria-hidden={!sidebarOpen}
          style={{
            height: "100%",
            display: "flex",
            pointerEvents: sidebarOpen ? "auto" : "none",
          }}
        >
          <MemberSidebar
            members={members}
            currentConnectionId={currentConnectionId}
            currentServerUserId={currentServerUserId}
            currentUserRole={currentUserRole}
            currentServerConnected={currentServerConnected}
            serverHost={serverHost}
            adminActions={adminActions}
            onOpenDm={onOpenDm}
            onToggleBlock={onToggleBlock}
            onReport={onReport}
            isBlocked={isBlocked}
            pinned={pinned}
            onTogglePinned={onTogglePinned}
          />
        </div>
      </div>
    </motion.div>
  </div>
);
