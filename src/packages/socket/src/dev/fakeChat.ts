/**
 * Chat from the fake participants, for looking at messages you cannot easily
 * make yourself, and at a channel that looks used (GRYT-649). The server allows
 * one connection per user; this invents the second person.
 *
 * Delivered by calling the client's own `chat:new` listeners rather than by
 * appending to the rendered list. That is the difference between seeing a
 * message and exercising one: the real handler is what plays the sound, marks
 * the channel unread, bumps the badge and writes the cache. Nothing is sent to
 * the server, so nobody else sees any of it and nothing is stored.
 *
 * It plays scripted conversations rather than firing random lines on a fixed
 * interval, so the gaps come from what is being said. The old templates are
 * still here as one-line scripts: they exist to exercise code blocks, link
 * previews, mentions and wrapping, and a prettier conversation that stopped
 * covering those would be a downgrade.
 */
import { useEffect, useRef } from "react";

import type { ChatMessage } from "../components/chatUtils";
import { deliverServerEvent, type ListenerSource } from "./fakeServerEvents";

export interface FakeChatSender {
  serverUserId: string;
  nickname: string;
}


/** What one person does at one moment in a script. */
interface Beat {
  /**
   * Which of the script's cast is acting, as an index. The cast is drawn from
   * the fake participants when the script starts, so the same three people play
   * it through rather than a new stranger per line.
   */
  who: number;
  /** What they say. Omitted when the beat is only a reaction. */
  say?: (ctx: BeatContext) => string;
  /**
   * React to a message this script has already sent, counted back from the most
   * recent — 0 is the last one.
   */
  reactTo?: number;
  /** Which emoji they react with. Defaults to one of the server's. */
  reactWith?: (ctx: BeatContext) => string;
  /**
   * Land on top of the previous beat rather than after it. Two people typing at
   * once is most of what makes a channel feel busy, and no amount of varying
   * one gap produces it.
   */
  together?: boolean;
}

interface BeatContext {
  selfNickname: string;
  /** A custom emoji on this server, or null if it has none. */
  emoji: string | null;
  /** Another one, so a message and its reaction are not always the same. */
  otherEmoji: string | null;
}

/** Falls back to a unicode emoji, so a server with no custom ones still works. */
function customOr(emoji: string | null, fallback: string): string {
  return emoji ? `:${emoji}:` : fallback;
}

/**
 * The conversations.
 *
 * Each is a short exchange that ends. Between them the fixture goes quiet for
 * longer than any gap inside one, which is what makes the channel read as
 * having lulls rather than as a stream.
 *
 * The single-beat ones at the bottom are the old templates. They are what
 * covers a code block, a link preview and a wall of text, and they still fire
 * on their own so those layouts keep being exercised.
 */
const SCRIPTS: Beat[][] = [
  [
    { who: 0, say: () => "kan noen se på loggene? de ser rare ut" },
    { who: 1, say: () => "hvilke da" },
    { who: 0, say: () => "sfu-en, den spammer reconnect" },
    { who: 2, say: () => "ja jeg ser det samme her", together: true },
    { who: 1, say: () => "skal ta en titt", reactTo: 1 },
    { who: 0, say: ({ emoji }) => customOr(emoji, "🙏") },
  ],
  [
    { who: 0, say: ({ selfNickname }) => `@${selfNickname} har du tid et sekund?` },
    { who: 1, say: () => "han er i møte tror jeg" },
    { who: 0, say: () => "ah ok, det haster ikke" },
    { who: 1, reactTo: 0, reactWith: () => "👍" },
  ],
  [
    { who: 0, say: () => "deploya nettopp" },
    { who: 1, say: () => "🎉", together: true },
    { who: 2, say: ({ emoji }) => customOr(emoji, "🎉") },
    { who: 1, say: () => "ser bra ut her" },
    { who: 0, reactTo: 0, reactWith: ({ otherEmoji }) => customOr(otherEmoji, "❤️") },
  ],
  [
    { who: 0, say: () => "https://gryt.chat" },
    { who: 1, say: () => "den er fin" },
    { who: 1, say: () => "hvem laget den?", together: true },
    { who: 0, say: () => "hehe" },
  ],
  [
    { who: 0, say: () => "se her: https://docs.gryt.chat/docs/guide/ai" },
    { who: 1, reactTo: 0, reactWith: () => "👀" },
  ],
  [
    { who: 0, say: () => "```ts\nconst n = tiles.length;\nconsole.log(n);\n```" },
    { who: 1, say: () => "den logger jo bare lengden" },
    { who: 0, say: () => "ja det er poenget" },
  ],
  [{ who: 0, say: () => "**dette** er _formatert_ tekst med `kode` i seg" }],
  [
    {
      who: 0,
      say: () =>
        "lang melding for å se hvordan den brytes: " +
        "jeg satt og tenkte på hvordan vi skal håndtere de tilfellene der noen " +
        "kobler seg til med dårlig nett, og om vi i det hele tatt skal vise noe " +
        "annet enn en spinner mens vi venter på at det ordner seg av seg selv.",
    },
    { who: 1, say: () => "spinner holder", together: true },
  ],
  [{ who: 0, say: ({ emoji }) => customOr(emoji, "😄") }],
];

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function jitter(ms: number, spread = 0.35): number {
  return Math.round(ms * (1 - spread + Math.random() * spread * 2));
}

/**
 * How long this line takes to arrive.
 *
 * Reading the previous line, then typing this one. Neither is precise and it
 * does not need to be — what it has to avoid is every message landing on the
 * same beat, which is the tell that produced this change.
 */
function gapFor(text: string | undefined, together: boolean): number {
  if (together) return jitter(260, 0.7);
  if (!text) return jitter(900);

  const typing = Math.min(4200, 240 + text.length * 26);
  return jitter(650 + typing);
}

export interface FakeChatOptions {
  running: boolean;
  connection: ListenerSource | null | undefined;
  conversationId: string | undefined;
  senders: FakeChatSender[];
  selfNickname: string;
  /** The server's custom emoji names, so `:name:` renders as one. */
  emojiNames: string[];
  /** Roughly how long the channel is quiet between conversations, in seconds. */
  everySeconds: number;
}

export function useFakeChat({
  running,
  connection,
  conversationId,
  senders,
  selfNickname,
  emojiNames,
  everySeconds,
}: FakeChatOptions): void {
  // Read through a ref so changing any of these does not restart the schedule
  // and lose the conversation halfway through.
  const latest = useRef({ connection, conversationId, senders, selfNickname, emojiNames });
  latest.current = { connection, conversationId, senders, selfNickname, emojiNames };

  useEffect(() => {
    if (!import.meta.env.DEV || !running) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    /** What this run of the script has sent, newest last, so a beat can react. */
    let sent: ChatMessage[] = [];

    const deliver = (event: string, message: ChatMessage) => {
      deliverServerEvent(latest.current.connection, event, message);
    };

    /** Returns what was said, so the next gap can be sized from it. */
    const playBeat = (beat: Beat, cast: FakeChatSender[]): string | undefined => {
      const { conversationId, selfNickname, emojiNames } = latest.current;
      if (!conversationId) return undefined;

      const sender = cast[beat.who % cast.length];
      const ctx: BeatContext = {
        selfNickname,
        emoji: emojiNames[0] ?? null,
        otherEmoji: emojiNames[1] ?? emojiNames[0] ?? null,
      };

      // A reaction, on a message this script already sent.
      if (beat.reactTo !== undefined) {
        const target = sent[sent.length - 1 - beat.reactTo];
        if (!target) return undefined;

        const src = beat.reactWith
          ? beat.reactWith(ctx)
          : customOr(pick(emojiNames) ?? null, "👍");

        const existing = target.reactions ?? [];
        const already = existing.find((r) => r.src === src);
        const reactions = already
          ? existing.map((r) =>
              r.src === src
                ? { ...r, amount: r.amount + 1, users: [...r.users, sender.serverUserId] }
                : r,
            )
          : [...existing, { src, amount: 1, users: [sender.serverUserId] }];

        // Mutated in place as well as sent, so a later beat reacting to the same
        // message adds to what is there rather than replacing it.
        target.reactions = reactions;

        // The whole message, because that is what chat:reaction carries and what
        // the client merges the reactions out of.
        deliver("chat:reaction", { ...target, reactions });
        return undefined;
      }

      if (!beat.say) return undefined;

      const text = beat.say(ctx);

      const message: ChatMessage = {
        conversation_id: conversationId,
        message_id: `fake-msg-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        sender_server_id: sender.serverUserId,
        text,
        attachments: null,
        created_at: new Date().toISOString(),
        reactions: null,
        // Answering the line before this one, when there is one and it was
        // somebody else. Replies render a quoted preview, which is its own
        // layout and worth seeing filled in.
        reply_to_message_id:
          sent.length > 0 &&
          sent[sent.length - 1].sender_server_id !== sender.serverUserId &&
          Math.random() < 0.2
            ? sent[sent.length - 1].message_id
            : null,
        sender_nickname: sender.nickname,
      };

      sent.push(message);
      deliver("chat:new", message);

      return text;
    };

    const runScript = () => {
      const { senders, connection } = latest.current;
      if (stopped) return;

      if (!connection || senders.length === 0) {
        timer = setTimeout(runScript, 2000);
        return;
      }

      const script = pick(SCRIPTS);

      // A cast for this conversation, so the same people play it out. Shuffled
      // per script, so the same exchange is not always the same three.
      const cast = [...senders].sort(() => Math.random() - 0.5);
      sent = [];

      let index = 0;
      const step = () => {
        if (stopped) return;

        if (index >= script.length) {
          // The lull between conversations. Longer than any gap inside one, and
          // the only place the configured number is used.
          timer = setTimeout(runScript, jitter(Math.max(1, everySeconds) * 1000, 0.6));
          return;
        }

        const beat = script[index++];
        const said = playBeat(beat, cast);

        /* Sized from what was just said rather than from what is coming: the
           next person has to read this before they answer it, and the text of
           the next beat is only known by calling its template, which would then
           be called twice. */
        const next = script[index];
        timer = setTimeout(step, gapFor(said, Boolean(next?.together)));
      };

      step();
    };

    // Straight in, so pressing Start does something visible rather than leaving
    // you wondering whether it took.
    runScript();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, everySeconds]);
}
