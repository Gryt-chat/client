// Settings search matching, kept apart from the index so a node check can import it.
// Every word typed has to hit; title beats keywords beats section beats description.

export interface Searchable {
  title: string;
  section: string;
  description: string;
  keywords?: string[];
}

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Levenshtein distance, giving up once it passes `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (Math.min(...row) > max) return false;
    prev = row;
  }
  return prev[b.length] <= max;
}

/** A typo in a word, or in the start of one while it's still being typed. */
function fuzzy(term: string, text: string): boolean {
  if (term.length < 4) return false;
  const max = term.length >= 8 ? 2 : 1;
  return words(text).some((word) =>
    within(term, word, max) || (word.length > term.length && within(term, word.slice(0, term.length), max)),
  );
}

function termScore(term: string, entry: Searchable): number {
  const keywords = (entry.keywords ?? []).join(" ").toLowerCase();
  const title = entry.title.toLowerCase();
  const section = entry.section.toLowerCase();
  if (title.includes(term)) return 8;
  if (keywords.includes(term)) return 6;
  if (section.includes(term)) return 4;
  if (entry.description.toLowerCase().includes(term)) return 2;
  // Typos only count in the short fields. Across a description they match nearly anything.
  if (fuzzy(term, title)) return 5;
  if (fuzzy(term, keywords)) return 3;
  if (fuzzy(term, section)) return 1;
  return 0;
}

/** Matches, best first. Ties keep the order they were given in. */
export function matchSettings<T extends Searchable>(entries: T[], query: string): T[] {
  const terms = words(query);
  if (!terms.length) return [];

  const scored: { entry: T; score: number }[] = [];
  for (const entry of entries) {
    let score = 0;
    for (const term of terms) {
      const s = termScore(term, entry);
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score) scored.push({ entry, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.entry);
}
