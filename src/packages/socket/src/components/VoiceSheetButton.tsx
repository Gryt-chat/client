import { IconButton } from "@gryt/ui";
import type { StreamSources } from "@gryt/voice";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { PiPhoneCallFill } from "react-icons/pi";

import type { PeerLatencyStats } from "../hooks/usePeerLatency";
import type { Client } from "../types/clients";
import type { AdminActions, MemberInfo } from "./MemberSidebar";
import { MobileSheet } from "./MobileSheet";
import { VoiceView } from "./VoiceView";

/** A role id. The server defines its own; this only passes one along. */
type Role = string;

/**
 * The way back to a call from a layout with no room to draw one.
 *
 * Two layouts are too narrow for the voice panel and drop it: the phone layout
 * below 768, and the one-channel window below 520. Dropping the panel also
 * drops mute, deafen and leave, and none of that stops the connection — the
 * microphone is still open. Without this button the only way out of a call is
 * to make the window bigger again, which is not something you want to be
 * looking for while you are the one being heard.
 *
 * The phone layout had this already. It lives here rather than inside
 * `MobileServerView` so the tiny window renders the same button and the same
 * sheet, instead of a second set of call controls to keep in step.
 */
export const VoiceSheetButton = ({
  connected,
  ...voice
}: {
  /** In a call on this server. The button is only drawn when this is true. */
  connected: boolean;
  serverHost: string;
  currentServerConnected: string | null;
  currentChannelId?: string;
  clientsForHost: Record<string, Client>;
  members?: MemberInfo[];
  clientsSpeaking: Record<string, boolean>;
  isConnecting: boolean;
  currentConnectionId?: string;
  isCall?: boolean;
  onDisconnect?: () => void;
  peerLatency?: Record<string, PeerLatencyStats>;
  onDisconnectUser?: (targetServerUserId: string) => void;
  currentUserRole?: Role;
  adminActions?: AdminActions;
  videoStreams?: Record<string, MediaStream>;
  streamSources?: StreamSources;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <AnimatePresence>
        {connected && (
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
            <IconButton
              size="large"
              aria-label="Open call controls"
              onClick={() => setOpen(true)}
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

      <MobileSheet open={open} onClose={() => setOpen(false)} side="bottom">
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          <VoiceView showVoiceView voiceWidth="100%" {...voice} />
        </div>
      </MobileSheet>
    </>
  );
};
