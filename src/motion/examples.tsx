import type { ForumTag } from "@/settings/src/types/server";

import { avatarSeed, generatedAvatarUrl } from "../packages/common/src/utils/owlAvatar";
import type { ChatMessage } from "../packages/socket/src/components/chatUtils";
import { ForumView } from "../packages/socket/src/components/ForumView";
import { type MessageMeta, MessageRow } from "../packages/socket/src/components/MessageRow";
import { customOwlUrl } from "./people";
import { getCustomEmojis } from "../packages/socket/src/utils/emojiData";

const noop = () => {};
const at = (min: number) => new Date(Date.UTC(2026, 10, 6, 20, min)).toISOString();

export type Line = { id: string; who: string; text: string | null; min: number; bot?: boolean; webhook?: boolean; first?: boolean; system?: boolean } & Partial<ChatMessage>;

function Row({ line, serverHost = "motion.gryt", onReaction = noop }: { line: Line; serverHost?: string; onReaction?: (src: string, m: ChatMessage) => void }) {
  const { id, who, text, min, bot, webhook, first = true, system, ...rest } = line;
  const message: ChatMessage = {
    conversation_id: "motion", message_id: id, sender_server_id: `u-${who}`, text, attachments: null, created_at: at(min),
    reactions: null, sender_nickname: who, sender_is_bot: bot, ...rest,
  };
  const meta: MessageMeta = {
    isFirstInGroup: first, dayBreak: null, showNewMessageDivider: false, senderName: who, avatarUrl: who === "Gryt" ? "/logo.svg" : customOwlUrl(who) ?? generatedAvatarUrl(avatarSeed(who) ?? who),
    isSelf: false, isFirstEdited: false, isSystem: !!system, systemEvent: system ? "joined" : undefined, isWebhook: !!webhook, isBot: bot,
  };
  return (
    <MessageRow
      message={message} meta={meta} replyPreviewText={null} isMentioned={false} customEmojiList={getCustomEmojis(serverHost) as never} memberNicknames={[]}
      blurProfanity={false} smileyConversion disabledSmileys={new Set()} serverHost={serverHost} currentUserId="u-me"
      currentUserNickname="me" canDeleteAny={false} chatMediaVolume={1} setChatMediaVolume={noop} onReaction={onReaction}
      onReply={noop} onEdit={noop} onReport={noop} onDelete={noop} scrollToMessage={noop} onLightboxOpen={noop}
    />
  );
}

export function Messages({ lines, serverHost, onReaction }: { lines: Line[]; serverHost?: string; onReaction?: (src: string, m: ChatMessage) => void }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{lines.map((l) => <Row key={l.id} line={l} serverHost={serverHost} onReaction={onReaction} />)}</div>;
}

export const PEOPLE: Line[] = [
  { id: "p1", who: "Carlo", text: "Who's on tonight? 🎮", min: 2 },
  { id: "p2", who: "Sivert", text: "me! dinner first, then **ranked**", min: 3, reactions: [{ src: "🔥", amount: 3, users: ["a", "b", "c"] }] },
  { id: "p3", who: "Justin", text: "save me a spot in the lounge", min: 4 },
];

export const AUTOMATED: Line[] = [
  { id: "b1", who: "Buildbot", text: "Nightly build `1.15.6` passed in 4m 12s ✅", min: 1, bot: true },
  {
    id: "w1", who: "GitHub", text: null, min: 2, webhook: true,
    cards: [{
      title: "PR merged: Threads fill the chat area", url: "https://github.com", color: "#968ff8",
      description: "Opening a thread now takes the whole chat column, with the channel one click away.",
      fields: [{ name: "Files", value: "6", inline: true }, { name: "Checks", value: "All green", inline: true }],
    }],
  },
];

export const FORUM_TAGS: ForumTag[] = [
  { id: "q", name: "Question", emoji: "❓" },
  { id: "bug", name: "Bug", emoji: "🐛" },
  { id: "idea", name: "Idea", emoji: "💡" },
];

const topic = (id: string, title: string, who: string, status: "open" | "solved", replies: number, tags: string[], preview: string) => ({
  thread_id: id, conversation_id: "support", root_message_id: `r-${id}`, title, status, reply_count: replies, participant_count: Math.min(replies + 1, 5),
  created_at: at(0), last_message_at: at(replies), created_by: `u-${who}`, creator_nickname: who, creator_avatar_file_id: null, preview, tags,
});

const TOPICS = [
  topic("t1", "Mic sounds robotic on Bluetooth", "Al-Jackeson", "solved", 6, ["q"], "Switching the headset to its own mic profile fixed it."),
  topic("t2", "Screen share goes black on a second monitor", "Carlo", "open", 3, ["bug"], "Only on Wayland, the first screen is fine."),
  topic("t3", "Let us pin a thread to the top", "Pingy", "open", 9, ["idea"], "Would make the rules thread easy to find."),
];

/** Stands in for the server: answers the one question ForumView asks. */
function forumSocket() {
  const handlers = new Map<string, (p: unknown) => void>();
  return {
    connected: true,
    emit: (event: string) => {
      if (event === "forum:topics") setTimeout(() => handlers.get("forum:topics:list")?.({ conversation_id: "support", topics: TOPICS }), 0);
    },
    on: (event: string, cb: (p: never) => void) => handlers.set(event, cb as (p: unknown) => void),
    off: (event: string) => handlers.delete(event),
  };
}

const socket = forumSocket();

export function Forum() {
  return (
    <ForumView
      socketConnection={socket as never} conversationId="support" serverHost="motion.gryt" currentUserId="u-me"
      forumTags={FORUM_TAGS} onOpenTopic={noop}
    />
  );
}
