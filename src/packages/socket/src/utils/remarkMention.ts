import type { Link, PhrasingContent, Root, Text } from "mdast";
import type { Plugin } from "unified";
import { CONTINUE, visit } from "unist-util-visit";

function buildReplacements(
  value: string,
  sortedNicknames: string[],
): PhrasingContent[] | null {
  const parts: PhrasingContent[] = [];
  let remaining = value;
  let changed = false;

  while (remaining.length > 0) {
    let earliest = -1;
    let matchedLen = 0;

    for (const nick of sortedNicknames) {
      const idx = remaining.toLowerCase().indexOf(`@${nick.toLowerCase()}`);
      if (idx === -1) continue;
      if (idx > 0 && /\w/.test(remaining[idx - 1])) continue;
      const afterIdx = idx + 1 + nick.length;
      if (afterIdx < remaining.length && /\w/.test(remaining[afterIdx])) continue;
      if (earliest === -1 || idx < earliest || (idx === earliest && nick.length > matchedLen)) {
        earliest = idx;
        matchedLen = nick.length;
      }
    }

    if (earliest === -1) {
      parts.push({ type: "text", value: remaining } as Text);
      break;
    }

    if (earliest > 0) {
      parts.push({ type: "text", value: remaining.slice(0, earliest) } as Text);
    }

    const original = remaining.slice(earliest + 1, earliest + 1 + matchedLen);
    parts.push({
      type: "link",
      url: "mention:",
      children: [{ type: "text", value: `@${original}` } as Text],
    } as Link);

    changed = true;
    remaining = remaining.slice(earliest + 1 + matchedLen);
  }

  return changed ? parts : null;
}

export function createRemarkMention(nicknames: string[]): Plugin<[], Root> {
  const sorted = [...nicknames].sort((a, b) => b.length - a.length);

  return () => (tree: Root) => {
    if (sorted.length === 0) return;

    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index == null) return;
      if (!node.value.includes("@")) return;

      const replacements = buildReplacements(node.value, sorted);
      if (!replacements) return;

      parent.children.splice(index, 1, ...replacements);
      return [CONTINUE, index] as const;
    });
  };
}
