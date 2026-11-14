// The quick reaction row skips custom emoji the server no longer has, and fills the gap with defaults.
import assert from "node:assert/strict";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
} });

const { getFrequentReactions, recordReaction } = await import("../src/packages/socket/src/utils/recentReactions.ts");

for (const src of [":Clap:", ":Clap:", ":Gone:", ":Gone:", "🔥"]) recordReaction(src, "chat.example");
const known = new Set(["Clap"]);
const usable = (src: string) => !/^:.+:$/.test(src) || known.has(src.slice(1, -1));

assert.deepEqual(getFrequentReactions(4, "chat.example", usable), [":Clap:", "🔥", "👍", "❤️"]);
assert.ok(getFrequentReactions(4, "chat.example").includes(":Gone:"), "without a filter, as before");
console.log("quick reactions: ok");
