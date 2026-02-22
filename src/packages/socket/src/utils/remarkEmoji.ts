import { nameToEmoji } from "gemoji";
import type { PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { CONTINUE, visit } from "unist-util-visit";

import { getCustomEmojis } from "./emojiData";

export type CustomEmojiEntry = {
  name: string;
  url: string;
};

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
