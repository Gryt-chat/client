import { nameToEmoji } from "gemoji";
import type { PhrasingContent,Root, Text } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;

export type CustomEmojiEntry = {
  name: string;
  url: string;
};

function buildReplacements(
  value: string,
  customEmojis: Map<string, string>,
): PhrasingContent[] {
  const parts: PhrasingContent[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(SHORTCODE_RE)) {
    const code = match[1];
    const start = match.index!;

    if (start > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, start) } as Text);
    }

    const unicode = nameToEmoji[code];
    if (unicode) {
      parts.push({ type: "text", value: unicode } as Text);
    } else if (customEmojis.has(code)) {
      const emojiNode = {
        type: "image" as const,
        url: customEmojis.get(code)!,
        alt: `:${code}:`,
        title: `:${code}:`,
        data: { hProperties: { className: "inline-emoji", "data-emoji-name": code } },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parts.push(emojiNode as any);
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

export const remarkEmoji: (customEmojis?: CustomEmojiEntry[]) => Plugin<[], Root> =
  (customEmojis = []) => {
    const customMap = new Map(customEmojis.map((e) => [e.name, e.url]));

    return () => (tree: Root) => {
      visit(tree, "text", (node: Text, index, parent) => {
        if (!parent || index == null) return;
        if (!SHORTCODE_RE.test(node.value)) return;
        SHORTCODE_RE.lastIndex = 0;

        const replacements = buildReplacements(node.value, customMap);
        if (replacements.length === 1 && replacements[0].type === "text" && (replacements[0] as Text).value === node.value) {
          return;
        }
        parent.children.splice(index, 1, ...replacements);
      });
    };
  };
