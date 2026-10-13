/** A poll as the server shows it to this viewer (GRYT-1732). Raw votes never arrive. */
export interface PublicPoll {
  question: string;
  options: { text: string; count: number; voters?: string[] }[];
  multi: boolean;
  anonymous: boolean;
  ends_at: string | null;
  allowed_roles: string[] | null;
  closed: boolean;
  voter_count: number;
  /** This viewer's picks. Absent on a broadcast that wasn't addressed to anyone. */
  mine?: number[];
}

/** What chat:send takes as `poll`. */
export interface NewPoll {
  question: string;
  options: string[];
  multi: boolean;
  anonymous: boolean;
  ends_in_seconds: number | null;
  allowed_roles: string[] | null;
}

export const POLL_OPTIONS_MAX = 10;
export const POLL_QUESTION_MAX = 300;
export const POLL_OPTION_MAX = 100;

export const POLL_DURATIONS: { label: string; seconds: number | null }[] = [
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 24 * 60 * 60 },
  { label: "2 days", seconds: 2 * 24 * 60 * 60 },
  { label: "1 week", seconds: 7 * 24 * 60 * 60 },
  { label: "Never", seconds: null },
];

/** The picks after clicking `index`: a single-answer poll swaps, a multi toggles. */
export function nextPicks(poll: Pick<PublicPoll, "multi">, mine: readonly number[], index: number): number[] {
  if (!poll.multi) return mine.length === 1 && mine[0] === index ? mine.slice() : [index];
  return mine.includes(index) ? mine.filter((i) => i !== index) : [...mine, index].sort((a, b) => a - b);
}

/** Whole percent of voters, so a multi-answer poll's rows can add up past 100. */
export function pollPercent(count: number, voters: number): number {
  return voters > 0 ? Math.round((100 * count) / voters) : 0;
}

/** "ends in 2 days", "ends in 40 minutes", or null once it's over or never ends. */
export function endsInText(endsAt: string | null, now = Date.now()): string | null {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now;
  if (!(ms > 0)) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `ends in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `ends in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `ends in ${days} day${days === 1 ? "" : "s"}`;
}
