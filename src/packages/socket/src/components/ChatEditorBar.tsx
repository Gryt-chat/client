import { Button } from "@gryt/ui";
import type { RefObject } from "react";

import { ChatEditor, type ChatEditorHandle } from "./ChatEditor";
import type { ChatMessage } from "./chatUtils";
import { getReplyPreview } from "./chatViewHelpers";

interface ChatEditorBarProps {
  replyingTo: ChatMessage | null;
  editingMessage: ChatMessage | null;
  editorRef: RefObject<ChatEditorHandle | null>;
  placeholder: string;
  disabled: boolean;
  allowFiles?: boolean;
  maxFileSize?: number | null;
  memberList: { nickname: string; serverUserId: string; avatarUrl: string | null }[];
  getSenderName: (msg: ChatMessage) => string;
  onCancelReply: () => void;
  onCancelEditing: () => void;
  onSend: (markdown: string, files: File[]) => void;
  onArrowUpEmpty: () => void;
  onTyping?: () => void;
  onStopTyping?: () => void;
  serverHost?: string;
}

export function ChatEditorBar({
  replyingTo,
  editingMessage,
  editorRef,
  placeholder,
  disabled,
  allowFiles,
  maxFileSize,
  memberList,
  getSenderName,
  onCancelReply,
  onCancelEditing,
  onSend,
  onArrowUpEmpty,
  onTyping,
  onStopTyping,
  serverHost,
}: ChatEditorBarProps) {
  return (
    <>
      {replyingTo && (
        <div className="flex items-center gap-2" style={{
            padding: "6px 12px",
            marginBottom: "4px",
            borderLeft: "3px solid var(--gryt-accent-9)",
            background: "var(--gryt-neutral-4)",
            borderRadius: "0 var(--gryt-radius-md) var(--gryt-radius-md) 0",
            fontSize: "13px",
          }}>
          <div className="flex items-center gap-1" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <span className="text-sm text-gryt-muted">Replying to</span>
            <span className="text-sm font-bold">{getSenderName(replyingTo)}</span>
            <span className="text-xs text-gryt-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {getReplyPreview(replyingTo, 80)}
            </span>
          </div>
          <Button tone="ghost" size="xsmall"
            onClick={onCancelReply}
            style={{ padding: "2px 6px", minWidth: "auto", cursor: "pointer" }}
          >
            ✕
          </Button>
        </div>
      )}

      {editingMessage && (
        <div className="flex items-center gap-2" style={{
            padding: "6px 12px",
            marginBottom: "4px",
            borderLeft: "3px solid var(--gryt-warning-9)",
            background: "var(--gryt-neutral-4)",
            borderRadius: "0 var(--gryt-radius-md) var(--gryt-radius-md) 0",
            fontSize: "13px",
          }}>
          <div className="flex items-center gap-1" style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
            <span className="text-sm text-gryt-muted">Editing message</span>
            <span className="text-xs text-gryt-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 4 }}>
              press Escape to cancel
            </span>
          </div>
          <Button tone="ghost" size="xsmall"
            onClick={onCancelEditing}
            style={{ padding: "2px 6px", minWidth: "auto", cursor: "pointer" }}
          >
            ✕
          </Button>
        </div>
      )}

      <ChatEditor
        ref={editorRef}
        placeholder={placeholder}
        disabled={disabled}
        allowFiles={allowFiles}
        maxFileSize={maxFileSize}
        onSend={onSend}
        onArrowUpEmpty={onArrowUpEmpty}
        onCancel={editingMessage ? onCancelEditing : undefined}
        onTyping={onTyping}
        onStopTyping={onStopTyping}
        isEditing={!!editingMessage}
        memberList={memberList}
        serverHost={serverHost}
      />
    </>
  );
}
