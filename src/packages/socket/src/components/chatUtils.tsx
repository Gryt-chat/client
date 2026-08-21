import { Tooltip } from "@gryt/ui";

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
  /** Blob URL for local preview while the message is pending upload. */
  local_url?: string;
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
  pending?: boolean;
  failed?: boolean;
  nonce?: string;
  sender_nickname?: string;
  /**
   * Whether a bot wrote this.
   *
   * Derived by the server from the sender's identity, so it is neither
   * something a bot can shake off nor something a person can acquire.
   */
  sender_is_bot?: boolean;
  sender_avatar_file_id?: string;
  profanity_matches?: ProfanityMatchRange[];
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
  <div className="flex items-center gap-3" style={{ padding: "8px 0", width: "100%" }}>
    <div style={{ flex: 1, height: 1, background: "var(--gryt-neutral-6)" }} />
    <span className="text-xs text-gryt-muted font-medium" style={{ whiteSpace: "nowrap" }}>
      {formatDateSeparator(date)}
    </span>
    <div style={{ flex: 1, height: 1, background: "var(--gryt-neutral-6)" }} />
  </div>
);

export const NewMessagesDivider = () => (
  <div className="flex items-center gap-3" style={{ padding: "8px 0", width: "100%" }}>
    <div style={{ flex: 1, height: 1, background: "var(--gryt-danger-8)" }} />
    <span className="text-xs text-gryt-danger font-medium" style={{ whiteSpace: "nowrap" }}>
      New since last visit
    </span>
    <div style={{ flex: 1, height: 1, background: "var(--gryt-danger-8)" }} />
  </div>
);
