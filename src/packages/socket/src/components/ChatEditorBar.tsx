import { Button, Flex, Text } from "@radix-ui/themes";
import type { RefObject } from "react";

import { ChatEditor, type ChatEditorHandle } from "./ChatEditor";
import type { ChatMessage } from "./chatUtils";
import { getReplyPreview } from "./chatViewHelpers";

interface ChatEditorBarProps {
  replyingTo: ChatMessage | null;
  editingMessage: ChatMessage | null;
  editorRef: RefObject<ChatEditorHandle>;
  placeholder: string;
  disabled: boolean;
  maxFileSize?: number | null;
  memberList: { nickname: string; serverUserId: string; avatarUrl: string | null }[];
  getSenderName: (msg: ChatMessage) => string;
  onCancelReply: () => void;
  onCancelEditing: () => void;
  onSend: (markdown: string, files: File[]) => void;
  onArrowUpEmpty: () => void;
}

export function ChatEditorBar({
  replyingTo,
  editingMessage,
  editorRef,
  placeholder,
  disabled,
  maxFileSize,
  memberList,
  getSenderName,
  onCancelReply,
  onCancelEditing,
  onSend,
  onArrowUpEmpty,
}: ChatEditorBarProps) {
  return (
    <>
      {replyingTo && (
        <Flex
          align="center"
          gap="2"
          style={{
            padding: "6px 12px",
            marginBottom: "4px",
            borderLeft: "3px solid var(--accent-9)",
            background: "var(--gray-4)",
            borderRadius: "0 var(--radius-3) var(--radius-3) 0",
            fontSize: "13px",
          }}
        >
          <Flex align="center" gap="1" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <Text size="2" color="gray">Replying to</Text>
            <Text size="2" weight="bold">{getSenderName(replyingTo)}</Text>
            <Text size="1" color="gray" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {getReplyPreview(replyingTo, 80)}
            </Text>
          </Flex>
          <Button
            variant="ghost"
            size="1"
            onClick={onCancelReply}
            style={{ padding: "2px 6px", minWidth: "auto", cursor: "pointer" }}
          >
            ✕
          </Button>
        </Flex>
      )}

      {editingMessage && (
        <Flex
          align="center"
          gap="2"
          style={{
            padding: "6px 12px",
            marginBottom: "4px",
            borderLeft: "3px solid var(--amber-9)",
            background: "var(--gray-4)",
            borderRadius: "0 var(--radius-3) var(--radius-3) 0",
            fontSize: "13px",
          }}
        >
          <Flex align="center" gap="1" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <Text size="2" color="gray">Editing message</Text>
            <Text size="1" color="gray" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 4 }}>
              press Escape to cancel
            </Text>
          </Flex>
          <Button
            variant="ghost"
            size="1"
            onClick={onCancelEditing}
            style={{ padding: "2px 6px", minWidth: "auto", cursor: "pointer" }}
          >
            ✕
          </Button>
        </Flex>
      )}

      <ChatEditor
        ref={editorRef}
        placeholder={placeholder}
        disabled={disabled}
        maxFileSize={maxFileSize}
        onSend={onSend}
        onArrowUpEmpty={onArrowUpEmpty}
        onCancel={editingMessage ? onCancelEditing : undefined}
        isEditing={!!editingMessage}
        memberList={memberList}
      />
    </>
  );
}
