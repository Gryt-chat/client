import { Avatar, Flex, Text } from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";

import { getUploadsFileUrl } from "@/common";

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
          <Flex align="center" gap="1" style={{ padding: "2px 12px 4px" }}>
            {first && (
              <Avatar
                size="1"
                radius="full"
                fallback={first.nickname[0]}
                src={first.avatarFileId && serverHost ? getUploadsFileUrl(serverHost, first.avatarFileId, { thumb: true }) : undefined}
                style={{ width: 16, height: 16, flexShrink: 0 }}
              />
            )}
            <Text size="1" style={{ color: "var(--gray-11)", fontSize: 13 }}>
              {buildLabel(typingUsers)}
            </Text>
          </Flex>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
