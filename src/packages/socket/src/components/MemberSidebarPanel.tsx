import { motion } from "motion/react";
import { RefObject } from "react";

import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { MemberSidebar } from "./MemberSidebar";

type Role = "owner" | "admin" | "mod" | "member";

const SIDEBAR_SPRING = { type: "spring" as const, stiffness: 380, damping: 34 };

interface MemberSidebarPanelProps {
  sidebarOpen: boolean;
  sidebarWidthPx: number;
  hoverPx: number;
  contentRef: RefObject<HTMLDivElement>;
  isUnreachableWhileConnected: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  members: MemberInfo[];
  currentConnectionId: string | undefined;
  currentServerUserId: string | undefined;
  currentUserRole: Role | undefined;
  clientsSpeaking: Record<string, boolean>;
  currentServerConnected: string | null;
  serverHost: string;
  adminActions: AdminActions | undefined;
  pinned: boolean;
  onTogglePinned: () => void;
}

export const MemberSidebarPanel = ({
  sidebarOpen, sidebarWidthPx, hoverPx, contentRef,
  isUnreachableWhileConnected,
  onMouseEnter, onMouseLeave,
  members, currentConnectionId, currentServerUserId,
  currentUserRole, clientsSpeaking,
  currentServerConnected, serverHost,
  adminActions, pinned, onTogglePinned,
}: MemberSidebarPanelProps) => (
  <div
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
          background: "var(--gray-a4)",
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
            clientsSpeaking={clientsSpeaking}
            currentServerConnected={currentServerConnected}
            serverHost={serverHost}
            adminActions={adminActions}
            pinned={pinned}
            onTogglePinned={onTogglePinned}
          />
        </div>
      </div>
    </motion.div>
  </div>
);
