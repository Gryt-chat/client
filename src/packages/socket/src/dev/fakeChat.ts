/**
 * Chat from the fake participants, for looking at messages you cannot easily
 * make yourself.
 *
 * Everything a message can be — a mention, an emoji, a link with a preview, a
 * wall of text, a reply — takes a second person to produce, and the server
 * allows one connection per user. This invents the second person.
 *
 * Delivered by calling the client's own `chat:new` listeners rather than by
 * appending to the rendered list. That is the difference between seeing a
 * message and exercising one: the real handler is what plays the sound, marks
 * the channel unread, bumps the badge and writes the cache, and none of that
 * happens if you only push a row into an array. Nothing is sent to the server,
 * so nobody else sees any of it and nothing is stored.
 *
 * It runs until stopped. That is deliberate — an interval you have to start is
 * one you remember is on — but it does mean the Developer panel owns the only
 * off switch, so it is a button rather than a slider that can be left anywhere.
 */
import { useEffect, useRef } from "react";

import type { ChatMessage } from "../components/chatUtils";

/** Enough of a socket to deliver to, without depending on socket.io's types. */
interface ListenerSource {
  listeners: (event: string) => Array<(...args: unknown[]) => void>;
}

export interface FakeChatSender {
  serverUserId: string;
  nickname: string;
}

/**
 * What a fake message can be.
 *
 * Picked to cover the things that render differently rather than to look like
 * a real conversation: each one exercises a different path — mentions,
 * markdown, custom emoji, link previews, wrapping, replies.
 */
type Template = (ctx: {
  sender: FakeChatSender;
  selfNickname: string;
  emojiName: string | null;
}) => string;

const TEMPLATES: Template[] = [
  () => "kan noen se på loggene? de ser rare ut",
  () => "ja det funker her",
  ({ selfNickname }) => `@${selfNickname} kan du sjekke denne?`,
  ({ selfNickname }) => `takk @${selfNickname} 🙏`,
  () => "🎉🎉🎉",
  () => "**dette** er _formatert_ tekst med `kode` i seg",
  () => "```ts\nconst n = tiles.length;\nconsole.log(n);\n```",
  () => "https://gryt.chat",
  () => "se her: https://docs.gryt.chat/docs/guide/ai",
  () =>
    "lang melding for å se hvordan den brytes: " +
    "jeg satt og tenkte på hvordan vi skal håndtere de tilfellene der noen " +
    "kobler seg til med dårlig nett, og om vi i det hele tatt skal vise noe " +
    "annet enn en spinner mens vi venter på at det ordner seg av seg selv.",
  ({ emojiName }) => (emojiName ? `:${emojiName}:` : "😄"),
  () => "hehe",
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export interface FakeChatOptions {
  running: boolean;
  connection: ListenerSource | null | undefined;
  conversationId: string | undefined;
  senders: FakeChatSender[];
  selfNickname: string;
  /** A custom emoji on this server, so `:name:` renders as one. */
  emojiName: string | null;
  /** Seconds between messages. */
  everySeconds: number;
}

export function useFakeChat({
  running,
  connection,
  conversationId,
  senders,
  selfNickname,
  emojiName,
  everySeconds,
}: FakeChatOptions): void {
  // Read through a ref so changing any of these does not restart the interval
  // and reset the gap — you would never see a message while dragging a slider.
  const latest = useRef({ connection, conversationId, senders, selfNickname, emojiName });
  latest.current = { connection, conversationId, senders, selfNickname, emojiName };

  const lastMessageId = useRef<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV || !running) return;

    const send = () => {
      const { connection, conversationId, senders, selfNickname, emojiName } = latest.current;
      if (!connection || !conversationId || senders.length === 0) return;

      const listeners = connection.listeners("chat:new");
      if (listeners.length === 0) return;

      const sender = pick(senders);
      const text = pick(TEMPLATES)({ sender, selfNickname, emojiName });

      const messageId = `fake-msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const message: ChatMessage = {
        conversation_id: conversationId,
        message_id: messageId,
        sender_server_id: sender.serverUserId,
        text,
        attachments: null,
        created_at: new Date().toISOString(),
        reactions: null,
        // Every so often, answer the last one. Replies render a quoted preview,
        // which is its own layout and worth seeing filled in.
        reply_to_message_id:
          lastMessageId.current && Math.random() < 0.25 ? lastMessageId.current : null,
        sender_nickname: sender.nickname,
      };
      lastMessageId.current = messageId;

      for (const listener of listeners) {
        try {
          listener(message);
        } catch {
          // A listener that throws is the app's problem to show, not this
          // fixture's to swallow the rest of the batch over.
        }
      }
    };

    // One immediately, so pressing Start does something visible rather than
    // leaving you wondering whether it took.
    send();

    const interval = setInterval(send, Math.max(1, everySeconds) * 1000);
    return () => clearInterval(interval);
  }, [running, everySeconds]);
}
