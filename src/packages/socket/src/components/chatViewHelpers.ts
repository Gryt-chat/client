import type { ChatMessage } from "./chatUtils";
import { toDate } from "./chatUtils";
import type { MemberInfo } from "./MemberSidebar";
import type { MessageMeta } from "./MessageRow";

export const GROUP_GAP_MS = 5 * 60 * 1000;
export const SYSTEM_SENDER_ID = "system";
export const WEBHOOK_PREFIX = "webhook:";

export function getAttachmentPreview(msg: ChatMessage): string {
  const enriched = msg.enriched_attachments;
  if (enriched && enriched.length > 0) {
    const names = enriched.map((a) => a.original_name).filter(Boolean) as string[];
    if (names.length > 0) return names.join(", ");
  }
  return "Attachment";
}

export function getReplyPreview(msg: ChatMessage | null | undefined, maxLen: number): string {
  if (!msg) return "Original message";
  if (msg.text) return msg.text.length > maxLen ? msg.text.slice(0, maxLen) + "..." : msg.text;
  return getAttachmentPreview(msg);
}

export function buildMessageMetadata(
  chatMessages: ChatMessage[],
  newMessageMarkerId: string | null,
  currentUserId: string | undefined,
  getSenderName: (msg: ChatMessage) => string,
  getSenderAvatarUrl: (msg: ChatMessage) => string | undefined,
  memberList?: Record<string, MemberInfo>,
): MessageMeta[] {
  /**
   * Display names that more than one member is currently using.
   *
   * Built once per pass rather than per message: the member list is small, but
   * this runs for every message in the channel and a scan inside the map would
   * make it quadratic.
   */
  const ambiguousNames = new Set<string>();
  if (memberList) {
    const seen = new Set<string>();
    for (const member of Object.values(memberList)) {
      const name = member.nickname;
      if (!name) continue;
      if (seen.has(name)) ambiguousNames.add(name);
      else seen.add(name);
    }
  }

  let lastDay: string | null = null;
  return chatMessages.map((m, i): MessageMeta => {
    const prev = i > 0 ? chatMessages[i - 1] : null;
    const d = toDate(m.created_at);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const needsDayBreak = dayKey !== lastDay;
    lastDay = dayKey;

    const isSystem = m.sender_server_id === SYSTEM_SENDER_ID;
    const isWebhook = m.sender_server_id.startsWith(WEBHOOK_PREFIX);

    const timeSincePrev = prev ? d.getTime() - toDate(prev.created_at).getTime() : Infinity;
    const isFirstInGroup = isSystem ||
      !prev || prev.sender_server_id !== m.sender_server_id || timeSincePrev > GROUP_GAP_MS || needsDayBreak;

    const showNewMessageDivider = !!(newMessageMarkerId && prev && prev.message_id === newMessageMarkerId);

    const isSelf = !isSystem && !isWebhook && !!currentUserId && m.sender_server_id === currentUserId;

    // Your own messages resolve their author exactly like everyone else's.
    // They used to render from local settings instead, which meant the name
    // above your messages could disagree with the one the member sidebar and
    // every other participant saw — you read "Sivert" while the server, and so
    // everybody else, had "Unknown". Hiding that made it look like a display
    // quirk rather than the profile desync it was (GRYT-58).
    /* Which arrow the event row draws. Read off the text the server posts
       rather than a field, because the server sends these as ordinary message
       rows and adding a column for two verbs is not worth a migration. An
       unrecognised system message falls back to the "in" arrow, which is the
       right guess for anything that is not a departure. */
    const systemEvent: "joined" | "left" | undefined = isSystem
      ? (/\bleft the server\b/.test(m.text ?? "") ? "left" : "joined")
      : undefined;

    const senderName = isSystem ? "System" : getSenderName(m);
    const avatarUrl = isSystem ? undefined : getSenderAvatarUrl(m);
    const isFirstEdited = isFirstInGroup && !!m.edited_at;

    const sender =
      isSystem || isWebhook ? undefined : memberList?.[m.sender_server_id];

    return {
      isFirstInGroup,
      dayBreak: needsDayBreak ? d : null,
      showNewMessageDivider,
      senderName,
      avatarUrl,
      isSelf,
      isFirstEdited,
      isSystem,
      systemEvent,
      isWebhook,
      isBot: !isSystem && !isWebhook && m.sender_is_bot === true,
      sender,
      nameIsAmbiguous: !!sender && ambiguousNames.has(senderName),
    };
  });
}

export function buildMessageMap(chatMessages: ChatMessage[]): Map<string, ChatMessage> {
  const map = new Map<string, ChatMessage>();
  for (const m of chatMessages) map.set(m.message_id, m);
  return map;
}
