import { Avatar } from "@gryt/ui";
import { AnimatePresence, motion } from "motion/react";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import { useLocale } from "../../../../lib/localeContext";
import type { TypingUser } from "../hooks/useTypingIndicator";

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
  serverHost?: string;
  /** The #2 after a name someone else here also uses (GRYT-1674). */
  nameTags?: Map<string, string>;
}

function buildLabel(users: TypingUser[], t: (message: string, params?: Record<string, string | number>) => string, tags?: Map<string, string>): string {
  const name = (u: TypingUser) => {
    const tag = tags?.get(u.serverUserId);
    return tag ? `${u.nickname} ${tag}` : u.nickname;
  };
  if (users.length === 1) return t("chat.isTyping", { name: name(users[0]) });
  if (users.length === 2) return t("chat.andAreTyping", { first: name(users[0]), second: name(users[1]) });
  return t("chat.severalPeopleAreTyping");
}

export function TypingIndicator({ typingUsers, serverHost, nameTags }: TypingIndicatorProps) {
  const { t } = useLocale();
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
                src={resolveAvatarSrc(first.avatarFileId && serverHost ? getUploadsFileUrl(serverHost, first.avatarFileId, { thumb: true }) : undefined, first.nickname, first.avatarWorn)}
              />
            )}
            <span className="text-xs" style={{ color: "var(--gryt-neutral-11)", fontSize: 13 }}>
              {buildLabel(typingUsers, t, nameTags)}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
