import type { RefObject } from "react";
import { useCallback, useState } from "react";

import { getServerAccessToken } from "@/common";

import type { ChatEditorHandle } from "../components/ChatEditor";
import type { ChatMessage } from "../components/chatUtils";
import { recordReaction } from "../utils/recentReactions";

interface UseChatActionsParams {
  chatMessages: ChatMessage[];
  socketConnection?: unknown;
  currentUserId?: string;
  serverHost?: string;
  canDeleteAny?: boolean;
  canSend: boolean;
  isRateLimited?: boolean;
  sendChat: (text: string, files: File[], replyToMessageId?: string) => void;
  editMessage?: (messageId: string, conversationId: string, newText: string) => void;
  editorRef: RefObject<ChatEditorHandle>;
  forceScrollToBottomRef: { current: boolean };
}

export function useChatActions({
  chatMessages,
  socketConnection,
  currentUserId,
  serverHost,
  canDeleteAny,
  canSend,
  isRateLimited,
  sendChat,
  editMessage,
  editorRef,
  forceScrollToBottomRef,
}: UseChatActionsParams) {
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);
  const [pendingDeleteMessage, setPendingDeleteMessage] = useState<ChatMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    message: ChatMessage;
    position: { x: number; y: number };
  } | null>(null);

  const handleMessageRightClick = useCallback((event: React.MouseEvent, message: ChatMessage) => {
    event.preventDefault();
    setContextMenu({ message, position: { x: event.clientX, y: event.clientY } });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleReaction = useCallback((reactionSrc: string, message: ChatMessage) => {
    if (!socketConnection || !currentUserId) return;
    const accessToken = getServerAccessToken(serverHost || "");
    if (!accessToken) return;
    recordReaction(reactionSrc);
    (socketConnection as { emit: (event: string, data: unknown) => void }).emit("chat:react", {
      conversationId: message.conversation_id,
      messageId: message.message_id,
      reactionSrc,
      accessToken,
    });
  }, [socketConnection, currentUserId, serverHost]);

  const handleReply = useCallback((message: ChatMessage) => {
    setReplyingTo(message);
    editorRef.current?.focus();
  }, [editorRef]);

  const handleReport = useCallback(() => {
    const targetMessage = contextMenu?.message;
    if (!targetMessage || !socketConnection || !currentUserId) return;
    const accessToken = getServerAccessToken(serverHost || "");
    if (!accessToken) return;
    (socketConnection as { emit: (event: string, data: unknown) => void }).emit("chat:report", {
      conversationId: targetMessage.conversation_id,
      messageId: targetMessage.message_id,
      accessToken,
    });
  }, [contextMenu, socketConnection, currentUserId, serverHost]);

  const requestDelete = useCallback((message: ChatMessage) => {
    if (!socketConnection || !currentUserId) return;
    if (message.sender_server_id !== currentUserId && !canDeleteAny) return;
    setPendingDeleteMessage(message);
  }, [socketConnection, currentUserId, canDeleteAny]);

  const confirmDelete = useCallback(() => {
    if (!pendingDeleteMessage || !socketConnection) return;
    const accessToken = getServerAccessToken(serverHost || "");
    if (!accessToken) return;
    (socketConnection as { emit: (event: string, data: unknown) => void }).emit("chat:delete", {
      conversationId: pendingDeleteMessage.conversation_id,
      messageId: pendingDeleteMessage.message_id,
      accessToken,
    });
    setPendingDeleteMessage(null);
  }, [pendingDeleteMessage, socketConnection, serverHost]);

  const startEditing = useCallback((message: ChatMessage) => {
    if (!message.text) return;
    setEditingMessage(message);
    setReplyingTo(null);
    requestAnimationFrame(() => { editorRef.current?.setContent(message.text!); });
  }, [editorRef]);

  const cancelEditing = useCallback(() => {
    setEditingMessage(null);
    editorRef.current?.clear();
  }, [editorRef]);

  const handleArrowUpEmpty = useCallback(() => {
    if (!currentUserId) return;
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const msg = chatMessages[i];
      if (msg.sender_server_id === currentUserId && msg.text && !msg.pending && !msg.failed) {
        startEditing(msg);
        return;
      }
    }
  }, [chatMessages, currentUserId, startEditing]);

  const handleEditorSend = useCallback((markdown: string, files: File[]) => {
    if (editingMessage) {
      const trimmed = markdown.trim();
      if (trimmed && trimmed !== editingMessage.text?.trim() && editMessage) {
        editMessage(editingMessage.message_id, editingMessage.conversation_id, trimmed);
      }
      setEditingMessage(null);
      editorRef.current?.clear();
      return;
    }
    if (!canSend && !isRateLimited) return;
    forceScrollToBottomRef.current = true;
    sendChat(markdown, files, replyingTo?.message_id);
    setReplyingTo(null);
  }, [canSend, isRateLimited, sendChat, replyingTo, editingMessage, editMessage, editorRef, forceScrollToBottomRef]);

  const scrollToMessage = useCallback((messageId: string) => {
    const el = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => {
      el.style.background = "var(--accent-4)";
      setTimeout(() => { el.style.background = "transparent"; }, 1500);
    }, 300);
  }, []);

  const cancelReply = useCallback(() => setReplyingTo(null), []);

  return {
    replyingTo,
    editingMessage,
    pendingDeleteMessage,
    setPendingDeleteMessage,
    contextMenu,
    cancelReply,
    handleMessageRightClick,
    closeContextMenu,
    handleReaction,
    handleReply,
    handleReport,
    requestDelete,
    confirmDelete,
    startEditing,
    cancelEditing,
    handleArrowUpEmpty,
    handleEditorSend,
    scrollToMessage,
    isContextMenuOpen: !!contextMenu,
  };
}
