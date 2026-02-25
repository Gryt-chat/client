import { nameToEmoji } from "gemoji";
import type { PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { CONTINUE, visit } from "unist-util-visit";

import { getCustomEmojis } from "./emojiData";

export type CustomEmojiEntry = {
  name: string;
  url: string;
};

// ---------------------------------------------------------------------------
// Text-smiley → emoji-shortcode conversion
// ---------------------------------------------------------------------------

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

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const sortedSmileys = [...SMILEY_MAP.keys()].sort(
  (a, b) => b.length - a.length || a.localeCompare(b),
);

const smileyRegex = new RegExp(sortedSmileys.map(escapeForRegex).join("|"), "g");

const STARTS_WITH_WORD = new Set(sortedSmileys.filter((s) => /^\w/.test(s)));
const ENDS_WITH_WORD = new Set(sortedSmileys.filter((s) => /\w$/.test(s)));

function convertSmileys(text: string): string {
  return text.replace(smileyRegex, (match, offset) => {
    const end = offset + match.length;

    // :/ :\ =/ =\ inside URLs or paths (e.g. http://, C:\)
    if (
      /^[=:][-]?[/\\]$/.test(match) &&
      (offset > 0 && /\w/.test(text[offset - 1]) || end < text.length && text[end] === "/")
    ) {
      return match;
    }

    if (STARTS_WITH_WORD.has(match) && offset > 0 && /\w/.test(text[offset - 1])) {
      return match;
    }

    if (ENDS_WITH_WORD.has(match) && end < text.length && /\w/.test(text[end])) {
      return match;
    }

    const shortcode = SMILEY_MAP.get(match);
    return shortcode ? `:${shortcode}:` : match;
  });
}

/**
 * Convert common text smileys (e.g. `:)`, `:D`, `XD`) into gemoji shortcodes
 * so the existing emoji pipeline can render them. Skips code fences and inline
 * code spans to avoid mangling code snippets.
 */
export function preprocessSmileys(content: string): string {
  const parts = content.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts.map((part, i) => (i % 2 === 0 ? convertSmileys(part) : part)).join("");
}

/**
 * Replace custom emoji shortcodes in a raw content string before markdown
 * parsing. Checks both the passed list and the global custom emoji cache
 * so newly-uploaded emojis are always resolved.
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
 * Remark plugin that converts standard (gemoji) shortcodes like `:smile:` to
 * their Unicode equivalents. Custom emoji replacement is handled separately
 * by {@link preprocessCustomEmojis} before the markdown is parsed.
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
