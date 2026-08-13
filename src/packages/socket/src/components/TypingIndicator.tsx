import { Avatar } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import type { TypingUser } from "../hooks/useTypingIndicator";

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
  serverHost?: string;
}

function buildLabel(users: TypingUser[]): string {
  if (users.length === 1) return `${users[0].nickname} is typing...`;
  if (users.length === 2) return `${users[0].nickname} and ${users[1].nickname} are typing...`;
  return "Several people are typing...";
}

export function TypingIndicator({ typingUsers, serverHost }: TypingIndicatorProps) {
  const first = typingUsers[0] as TypingUser | undefined;

  return (
    <AnimatePresence>
      {typingUsers.length > 0 && (
        <motion.div
          key="typing-indicator"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          style={{ overflow: "hidden" }}
        >
          <div className="flex items-center gap-1" style={{ padding: "2px 12px 4px" }}>
            {/* 16px — this sits inline with 13px text, so it is closer to a
                glyph than to an avatar. */}
            {first && (
              <Avatar
                size="small"
                className="h-4 w-4 shrink-0 text-[9px]"
                fallback={first.nickname[0]}
                src={resolveAvatarSrc(first.avatarFileId && serverHost ? getUploadsFileUrl(serverHost, first.avatarFileId, { thumb: true }) : undefined, first.nickname)}
              />
            )}
            <span className="text-xs" style={{ color: "var(--gryt-neutral-11)", fontSize: 13 }}>
              {buildLabel(typingUsers)}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
