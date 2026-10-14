const MARK_START = "\u0002";
const MARK_END = "\u0003";

export const SEARCH_SHORTCUT =
  typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent) ? "⌘K" : "Ctrl+K";

export type SearchFilterKey = "from" | "in" | "has" | "before" | "after";
export const SEARCH_FILTER_KEYS: SearchFilterKey[] = ["from", "in", "has", "before", "after"];

/** A filter the person picked. `value` is what the server gets, `label` what the chip says. */
export interface SearchFilter {
  key: SearchFilterKey;
  value: string;
  label: string;
}

/** Splits a server snippet on its \u0002 … \u0003 marks, so the match can be drawn without HTML. */
export function snippetParts(snippet: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let rest = snippet;
  while (rest) {
    const start = rest.indexOf(MARK_START);
    const end = start === -1 ? -1 : rest.indexOf(MARK_END, start + 1);
    if (end === -1) {
      parts.push({ text: rest.split(MARK_START).join("").split(MARK_END).join(""), match: false });
      break;
    }
    if (start > 0) parts.push({ text: rest.slice(0, start), match: false });
    parts.push({ text: rest.slice(start + 1, end), match: true });
    rest = rest.slice(end + 1);
  }
  return parts.filter((p) => p.text);
}

/** The `from:al` being typed at the end of the box, if there is one. */
export function activeFilterToken(text: string): { key: SearchFilterKey; partial: string; start: number } | null {
  const m = /(^|\s)(from|in|has|before|after):(\S*)$/i.exec(text);
  if (!m) return null;
  return { key: m[2].toLowerCase() as SearchFilterKey, partial: m[3], start: m.index + m[1].length };
}

/** Day-precision dates for before:/after:, read in local time. Null when it isn't one. */
export function parseSearchDate(input: string, now = new Date()): Date | null {
  const s = input.trim().toLowerCase();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (s === "today") return startOfDay(now);
  if (s === "yesterday") return startOfDay(new Date(now.getTime() - 86_400_000));
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!iso) return null;
  const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return d.getMonth() === Number(iso[2]) - 1 ? d : null;
}

/** Hits come newest first; this cuts them into the days they were sent. */
export function groupByDay<T extends { created_at: string }>(hits: T[]): { day: string; hits: T[] }[] {
  const groups: { day: string; hits: T[] }[] = [];
  for (const hit of hits) {
    const d = new Date(hit.created_at);
    const day = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.hits.push(hit);
    else groups.push({ day, hits: [hit] });
  }
  return groups;
}
