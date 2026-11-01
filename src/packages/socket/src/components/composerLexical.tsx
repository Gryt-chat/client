import { $isAutoLinkNode, AutoLinkNode } from "@lexical/link";
import {
  BOLD_ITALIC_STAR,
  BOLD_STAR,
  CODE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  type TextMatchTransformer,
  type Transformer,
  UNORDERED_LIST,
} from "@lexical/markdown";
import {
  $applyNodeReplacement,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";
import type { JSX } from "react";

import { type EditorChannelName, type EditorPill, parseEditSegments, reserializeEditSegments } from "../utils/chatEditorMentions";

type SerializedMentionNode = Spread<{ pill: EditorPill }, SerializedTextNode>;

/** A mention, channel or role, as one token the caret steps over. Sent as the same link the old box wrote. */
export class MentionNode extends TextNode {
  __pill: EditorPill;

  static getType(): string {
    return "gryt-mention";
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__pill, node.__text, node.__key);
  }

  constructor(pill: EditorPill, text?: string, key?: NodeKey) {
    super(text ?? pill.text, key);
    this.__pill = pill;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.className = "chat-editor-mention";
    dom.spellcheck = false;
    return dom;
  }

  static importJSON(json: SerializedMentionNode): MentionNode {
    return $createMentionNode(json.pill);
  }

  exportJSON(): SerializedMentionNode {
    return { ...super.exportJSON(), type: "gryt-mention", pill: this.__pill };
  }

  markdown(): string {
    return reserializeEditSegments([{ pill: { dataset: this.__pill.dataset, text: this.__text } }]);
  }

  isTextEntity(): true {
    return true;
  }

  canInsertTextBefore(): false {
    return false;
  }

  canInsertTextAfter(): false {
    return false;
  }
}

export function $createMentionNode(pill: EditorPill): MentionNode {
  const node = new MentionNode(pill);
  node.setMode("token").toggleDirectionless();
  return $applyNodeReplacement(node);
}

export function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode;
}

type SerializedEmojiNode = Spread<{ name: string; url: string; remote: boolean }, SerializedLexicalNode>;

/** A custom emoji as its picture. Another server's goes as its image, since its name only resolves there. */
export class EmojiNode extends DecoratorNode<JSX.Element> {
  __name: string;
  __url: string;
  __remote: boolean;

  static getType(): string {
    return "gryt-emoji";
  }

  static clone(node: EmojiNode): EmojiNode {
    return new EmojiNode(node.__name, node.__url, node.__remote, node.__key);
  }

  constructor(name: string, url: string, remote: boolean, key?: NodeKey) {
    super(key);
    this.__name = name;
    this.__url = url;
    this.__remote = remote;
  }

  createDOM(): HTMLElement {
    return document.createElement("span");
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  getTextContent(): string {
    return this.markdown();
  }

  markdown(): string {
    return this.__remote ? `![:${this.__name}:](${this.__url})` : `:${this.__name}:`;
  }

  static importJSON(json: SerializedEmojiNode): EmojiNode {
    return $createEmojiNode(json.name, json.url, json.remote);
  }

  exportJSON(): SerializedEmojiNode {
    return { type: "gryt-emoji", version: 1, name: this.__name, url: this.__url, remote: this.__remote };
  }

  decorate(): JSX.Element {
    return <img className="inline-emoji" src={this.__url} alt={`:${this.__name}:`} draggable={false} />;
  }
}

export function $createEmojiNode(name: string, url: string, remote: boolean): EmojiNode {
  return $applyNodeReplacement(new EmojiNode(name, url, remote));
}

function $isEmojiNode(node: LexicalNode | null | undefined): node is EmojiNode {
  return node instanceof EmojiNode;
}

const MENTION_LINK = /\[([^\]\n]*)\]\(((?:mention|role|channel):[^)\s]*)\)/;

function mentionTransformer(channelName: EditorChannelName): TextMatchTransformer {
  return {
    dependencies: [MentionNode],
    export: (node) => ($isMentionNode(node) ? node.markdown() : null),
    importRegExp: MENTION_LINK,
    // Only on import: typing a mention goes through the @ list.
    regExp: /(?!)/,
    replace: (textNode, match) => {
      const pill = parseEditSegments(match[0], channelName).find((s) => "pill" in s);
      if (pill && "pill" in pill) textNode.replace($createMentionNode(pill.pill));
    },
    type: "text-match",
  };
}

const EMOJI_EXPORT: TextMatchTransformer = {
  dependencies: [EmojiNode],
  export: (node) => ($isEmojiNode(node) ? node.markdown() : null),
  regExp: /(?!)/,
  type: "text-match",
};

/** A URL typed into the box goes out as typed, the way chat linked it before, not as `[url](url)`. */
const AUTOLINK_EXPORT: TextMatchTransformer = {
  dependencies: [AutoLinkNode],
  export: (node) => ($isAutoLinkNode(node) ? node.getTextContent() : null),
  regExp: /(?!)/,
  type: "text-match",
};

function arrow(typed: string, symbol: string): TextMatchTransformer {
  return {
    dependencies: [],
    export: () => null,
    // Typing only: never rewrites a message loaded for editing.
    importRegExp: /(?!)/,
    regExp: new RegExp(`${typed}$`),
    replace: (node) => { node.setTextContent(symbol); },
    trigger: typed.slice(-1),
    type: "text-match",
  };
}

/** What the box reads and writes, mentions ahead of LINK so a mention link doesn't import as a plain link.
    No highlight: chat doesn't render `==x==`. */
export function composerTransformers(channelName: EditorChannelName): Transformer[] {
  return [
    HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST,
    BOLD_ITALIC_STAR, BOLD_STAR, ITALIC_STAR, STRIKETHROUGH, INLINE_CODE,
    mentionTransformer(channelName), EMOJI_EXPORT, AUTOLINK_EXPORT, LINK,
    arrow("->", "→"), arrow("<-", "←"), arrow("=>", "⇒"),
  ];
}
