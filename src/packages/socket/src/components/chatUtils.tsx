import { Tooltip } from "@gryt/ui";

import { LabelledDivider } from "./LabelledDivider";

export type Reaction = {
  src: string;
  amount: number;
  users: string[];
};

export type AttachmentMeta = {
  file_id: string;
  mime: string | null;
  size: number | null;
  original_name: string | null;
  width: number | null;
  height: number | null;
  has_thumbnail: boolean;
  /** Blob URL of the file itself, when it is decrypted or still being sent. */
  local_url?: string;
  /** A sealed file not fetched yet. Calling it fetches and decrypts it. */
  open_sealed?: () => Promise<Blob>;
};

/** A webhook card as the server stores it. Pictures are uploads on this server, never remote URLs. */
export type StoredWebhookCard = {
  title?: string;
  url?: string;
  description?: string;
  color?: string;
  author?: { name: string; url?: string; icon_file_id?: string };
  fields?: { name: string; value: string; inline: boolean }[];
  image_file_id?: string;
  thumbnail_file_id?: string;
  footer?: { text: string; icon_file_id?: string };
  timestamp?: string;
};

export interface ProfanityMatchRange {
  startIndex: number;
  endIndex: number;
}

export type ChatMessage = {
  conversation_id: string;
  message_id: string;
  sender_server_id: string;
  text: string | null;
  attachments: string[] | null;
  enriched_attachments?: AttachmentMeta[] | null;
  created_at: string | Date;
  edited_at?: string | Date | null;
  reactions: Reaction[] | null;
  reply_to_message_id?: string | null;
  /**
   * The thread this message belongs to, or absent for a channel message.
   * Independent of reply_to_message_id; replies show only in the panel.
   */
  thread_id?: string | null;
  pending?: boolean;
  failed?: boolean;
  nonce?: string;
  sender_nickname?: string;
  /**
   * Whether a bot wrote this. Derived by the server from the sender's identity,
   * so neither shakeable nor acquirable.
   */
  sender_is_bot?: boolean;
  sender_avatar_file_id?: string;
  profanity_matches?: ProfanityMatchRange[];
  /** Cards a webhook posted, drawn under the text (GRYT-1186). */
  cards?: StoredWebhookCard[] | null;
  /**
   * `text` is a line the server wrote for clients that cannot draw cards.
   * Not drawn in the row, and never a mention.
   */
  text_fallback?: boolean;
  /**
   * The sealed envelope, when this message was encrypted. Straight off the wire
   * and never rendered; {@link sealedState} says where it got to (GRYT-729).
   */
  sealed?: string | null;
  /**
   * Where an encrypted message got to. `locked` is having no wrapped key, which
   * is ordinary and permanent; `broken` is a key that does not open, which is not.
   */
  sealedState?: "opening" | "open" | "locked" | "broken";
};

// eslint-disable-next-line react-refresh/only-export-components
export function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatFullDate(d: Date): string {
  return d.toLocaleString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatMessageTime(d: Date): string {
  const now = new Date();
  if (isSameCalendarDay(d, now)) return formatTime(d);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameCalendarDay(d, yesterday)) return `Yesterday at ${formatTime(d)}`;

  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;

  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateSeparator(d: Date): string {
  const now = new Date();
  if (isSameCalendarDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameCalendarDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export const MessageTimestamp = ({ date }: { date: Date }) => (
  <Tooltip title={formatFullDate(date)}>
    {/*
      gray-11 is Radix's low-contrast *text* step. gray-9 and gray-10 are solid
      steps meant for backgrounds and borders, and against the message surface
      they measure 3.09 and 3.74 — under the 4.5 AA needs for text this size.
      gray-11 comes out at 7.58 and still reads as clearly secondary next to the
      body copy's 13.64.

      12px rather than 10px because 10 was the smallest text in the app by some
      margin, and a timestamp nobody can read is not doing its job.
    */}
    <span style={{ fontSize: 12, cursor: "default", whiteSpace: "nowrap", userSelect: "none", color: "var(--gryt-neutral-11)" }}>
      {formatMessageTime(date)}
    </span>
  </Tooltip>
);

export const DateSeparator = ({ date }: { date: Date }) => (
  <LabelledDivider className="py-2" labelClassName="text-gryt-muted font-medium">
    {formatDateSeparator(date)}
  </LabelledDivider>
);

export const NewMessagesDivider = () => (
  <LabelledDivider
    className="py-2"
    lineClassName="bg-gryt-danger-8"
    labelClassName="text-gryt-danger font-medium"
  >
    New since last visit
  </LabelledDivider>
);
