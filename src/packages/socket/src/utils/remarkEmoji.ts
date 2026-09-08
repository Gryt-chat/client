import { nameToEmoji } from "gemoji";
import type { PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { CONTINUE, visit } from "unist-util-visit";

import { getCustomEmojis } from "./emojiData";

export type CustomEmojiEntry = {
  name: string;
  url: string;
};

// ── Text-smiley → emoji-shortcode conversion ──────────────────────────────

const SMILEY_MAP = new Map<string, string>([
  // 5+ characters
  ["O:-)", "innocent"],
  ["0:-)", "innocent"],
  [">:-(", "angry"],
  [">:-)", "smiling_imp"],
  [">:-D", "imp"],
  [">:-O", "scream"],
  [">:-o", "scream"],
  [">:-P", "stuck_out_tongue_closed_eyes"],
  [">:-p", "stuck_out_tongue_closed_eyes"],
  [":'-(", "cry"],
  [":'-)","sweat_smile"],
  ["}:-)", "smiling_imp"],
  ["\\o/", "raised_hands"],

  // 4 characters
  ["</3", "broken_heart"],
  [">:D", "imp"],
  [">:O", "scream"],
  [">:o", "scream"],
  [">:P", "stuck_out_tongue_closed_eyes"],
  [">:p", "stuck_out_tongue_closed_eyes"],
  [">;)", "smiling_imp"],
  ["}:)", "smiling_imp"],
  ["D:<", "rage"],
  ["D-:", "disappointed"],
  ["8-D", "grin"],

  // 3 characters (with nose)
  [":-)", "slightly_smiling_face"],
  [":-D", "smile"],
  [":-P", "stuck_out_tongue"],
  [":-p", "stuck_out_tongue"],
  [":-b", "stuck_out_tongue"],
  [";-)", "wink"],
  [";-D", "wink"],
  [";-P", "stuck_out_tongue_winking_eye"],
  [";-p", "stuck_out_tongue_winking_eye"],
  [":-(", "disappointed"],
  [":-/", "confused"],
  [":-\\", "confused"],
  [":-|", "neutral_face"],
  [":-O", "open_mouth"],
  [":-o", "open_mouth"],
  [":-*", "kissing_heart"],
  [":-$", "flushed"],
  [":-S", "confused"],
  [":-s", "confused"],
  [":-X", "zipper_mouth_face"],
  [":-x", "zipper_mouth_face"],
  [":-#", "zipper_mouth_face"],
  [":-&", "no_mouth"],
  [":-@", "rage"],
  [":-]", "grin"],
  [":-[", "disappointed"],
  ["|-)", "sleeping"],
  ["|-O", "tired_face"],
  ["B-)", "sunglasses"],
  ["8-)", "sunglasses"],
  ["X-D", "laughing"],
  ["x-D", "laughing"],

  // 3 characters (other)
  [":'(", "cry"],
  [":,(", "cry"],
  [":'D", "joy"],
  [":')","sweat_smile"],
  ["O:)", "innocent"],
  ["0:)", "innocent"],
  ["3:)", "smiling_imp"],
  [">:(", "angry"],
  [">:)", "smiling_imp"],
  ["^_^", "smile"],
  ["^.^", "smile"],
  ["-_-", "expressionless"],
  [">_<", "persevere"],
  [">.<", "persevere"],
  ["T_T", "sob"],
  ["T.T", "sob"],
  ["Q_Q", "sob"],
  ["o_O", "flushed"],
  ["O_o", "flushed"],
  ["o_o", "open_mouth"],
  ["O_O", "astonished"],
  ["@_@", "dizzy_face"],
  ["*_*", "star_struck"],
  ["x_x", "skull"],
  ["X_X", "skull"],
  ["=)", "slightly_smiling_face"],
  ["=D", "smile"],
  ["=P", "stuck_out_tongue"],
  ["=p", "stuck_out_tongue"],
  ["=(", "disappointed"],
  ["=/", "confused"],
  ["=\\", "confused"],
  ["=|", "neutral_face"],
  ["=O", "open_mouth"],
  ["=o", "open_mouth"],
  ["=*", "kissing_heart"],
  ["=]", "grin"],
  ["=[", "disappointed"],
  ["=X", "zipper_mouth_face"],
  ["=x", "zipper_mouth_face"],
  ["=#", "zipper_mouth_face"],

  // 2 characters
  [":)", "slightly_smiling_face"],
  [":D", "smile"],
  [":P", "stuck_out_tongue"],
  [":p", "stuck_out_tongue"],
  [":b", "stuck_out_tongue"],
  [";)", "wink"],
  [";D", "wink"],
  [";P", "stuck_out_tongue_winking_eye"],
  [";p", "stuck_out_tongue_winking_eye"],
  [":(", "disappointed"],
  [":/", "confused"],
  [":\\", "confused"],
  [":|", "neutral_face"],
  [":O", "open_mouth"],
  [":o", "open_mouth"],
  [":*", "kissing_heart"],
  [":$", "flushed"],
  [":S", "confused"],
  [":s", "confused"],
  [":X", "zipper_mouth_face"],
  [":x", "zipper_mouth_face"],
  [":#", "zipper_mouth_face"],
  [":&", "no_mouth"],
  [":@", "rage"],
  [":>", "smirk"],
  [":3", "smiley_cat"],
  [":c", "pensive"],
  [":]", "grin"],
  [":[", "disappointed"],
  ["B)", "sunglasses"],
  ["8)", "sunglasses"],
  ["D:", "anguished"],
  ["D8", "scream"],
  ["DX", "weary"],
  ["D;", "cry"],
  ["<3", "heart"],
  ["^^", "blush"],
  ["XD", "laughing"],
  ["xD", "laughing"],
  ["o/", "wave"],
]);

export type SmileyEntry = { shortcode: string; smileys: string[] };

export const SMILEY_ENTRIES: SmileyEntry[] = (() => {
  const byCode = new Map<string, string[]>();
  for (const [smiley, code] of SMILEY_MAP) {
    let arr = byCode.get(code);
    if (!arr) { arr = []; byCode.set(code, arr); }
    if (!arr.includes(smiley)) arr.push(smiley);
  }
  return [...byCode.entries()].map(([shortcode, smileys]) => ({ shortcode, smileys }));
})();

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const sortedSmileys = [...SMILEY_MAP.keys()].sort(
  (a, b) => b.length - a.length || a.localeCompare(b),
);

const smileyRegex = new RegExp(sortedSmileys.map(escapeForRegex).join("|"), "g");

function isWhitespaceOrEdge(text: string, index: number): boolean {
  return index < 0 || index >= text.length || /\s/.test(text[index]);
}

function convertSmileys(text: string, disabled?: ReadonlySet<string>): string {
  return text.replace(smileyRegex, (match, offset) => {
    if (!isWhitespaceOrEdge(text, offset - 1) || !isWhitespaceOrEdge(text, offset + match.length)) {
      return match;
    }

    const shortcode = SMILEY_MAP.get(match);
    if (!shortcode) return match;
    if (disabled?.has(shortcode)) return match;
    return `:${shortcode}:`;
  });
}

/**
 * Convert common text smileys into gemoji shortcodes. Skips code fences and
 * inline code spans so snippets are not mangled.
 */
export function preprocessSmileys(
  content: string,
  disabledShortcodes?: ReadonlySet<string>,
): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, i) => (i % 2 === 0 ? convertSmileys(part, disabledShortcodes) : part))
    .join("");
}

/**
 * Replace custom emoji shortcodes before markdown parsing. Checks the passed list
 * and the global cache, so newly uploaded emoji resolve.
 */
export function preprocessCustomEmojis(
  content: string,
  customEmojis: CustomEmojiEntry[],
): string {
  const map = new Map<string, string>();
  for (const e of getCustomEmojis()) {
    if (e.url) map.set(e.name, e.url);
  }
  for (const e of customEmojis) {
    map.set(e.name, e.url);
  }
  if (map.size === 0) return content;

  return content.replace(/:([a-zA-Z0-9_+-]+):/g, (match, code) => {
    if (nameToEmoji[code]) return match;
    const url = map.get(code);
    if (url) return `![${match}](${url})`;
    return match;
  });
}

function buildReplacements(value: string): PhrasingContent[] {
  const parts: PhrasingContent[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(/:([a-zA-Z0-9_+-]+):/g)) {
    const code = match[1];
    const start = match.index!;

    if (start > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, start) } as Text);
    }

    const unicode = nameToEmoji[code];
    if (unicode) {
      parts.push({ type: "text", value: unicode } as Text);
    } else {
      parts.push({ type: "text", value: match[0] } as Text);
    }

    lastIndex = start + match[0].length;
  }

  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) } as Text);
  }

  return parts;
}

/**
 * Converts gemoji shortcodes to Unicode. Custom emoji are handled separately by
 * {@link preprocessCustomEmojis} before the markdown is parsed.
 */
export const remarkEmoji: Plugin<[], Root> = () => (tree: Root) => {
  visit(tree, "text", (node: Text, index, parent) => {
    if (!parent || index == null) return;
    if (!/:([a-zA-Z0-9_+-]+):/.test(node.value)) return;

    const replacements = buildReplacements(node.value);
    if (
      replacements.length === 1 &&
      replacements[0].type === "text" &&
      (replacements[0] as Text).value === node.value
    ) {
      return;
    }
    parent.children.splice(index, 1, ...replacements);
    return [CONTINUE, index] as const;
  });
};
