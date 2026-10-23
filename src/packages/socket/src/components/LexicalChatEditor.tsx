import { CodeNode } from "@lexical/code";
import { $isLinkNode, AutoLinkNode, LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isListNode, INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode, REMOVE_LIST_COMMAND } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
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
  UNORDERED_LIST,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $findMatchingParent } from "@lexical/utils";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { forwardRef, type RefObject, useEffect, useImperativeHandle, useRef, useState } from "react";

import { PiArrowUpBold } from "../../../../lib/icons";
import { termsGate } from "../../../../lib/termsGate";
import type { ChatEditorHandle } from "./ChatEditor";
import { FORMAT_GROUPS, MASS_MENTION } from "./composerButtons";
import type { ComposerFormat } from "./composerFormat";

/** What the composer reads and writes. No highlight: chat doesn't render `==x==`. */
const TRANSFORMERS = [HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST, BOLD_ITALIC_STAR, BOLD_STAR, ITALIC_STAR, STRIKETHROUGH, INLINE_CODE, LINK];

const TEXT_FORMATS: Partial<Record<ComposerFormat, TextFormatType>> = { bold: "bold", italic: "italic", strike: "strikethrough", code: "code" };

const THEME = {
  text: { bold: "lx-bold", italic: "lx-italic", strikethrough: "lx-strike", code: "lx-code" },
  heading: { h1: "lx-h1", h2: "lx-h2", h3: "lx-h3" },
  quote: "lx-quote",
  list: { ul: "lx-ul", ol: "lx-ol", listitem: "lx-li" },
  link: "gryt-link",
  code: "lx-codeblock",
  paragraph: "lx-p",
};

const spring = { type: "spring", stiffness: 520, damping: 34 } as const;

type Bar = { left: number; top: number; active: Set<ComposerFormat>; link: { key: string; url: string } | null };

function EnterSends({ onEnter }: { onEnter: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () => editor.registerCommand(KEY_ENTER_COMMAND, (e) => {
      if (!e) return false;
      e.preventDefault();
      // A new paragraph, not a <br>: `# ` and `- ` only become blocks at the start of one.
      if (e.shiftKey) editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
      else onEnter();
      return true;
    }, COMMAND_PRIORITY_HIGH),
    [editor, onEnter],
  );
  return null;
}

function FormatBar({ wrapRef }: { wrapRef: RefObject<HTMLDivElement | null> }) {
  const [editor] = useLexicalComposerContext();
  const [bar, setBar] = useState<Bar | null>(null);
  // Set on mousedown, before the box loses focus and the selection with it.
  const editingLink = useRef(false);
  const lastAt = useRef({ left: 0, top: 0 });
  const reduceMotion = useReducedMotion();
  if (bar) lastAt.current = { left: bar.left, top: bar.top };

  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      const sel = $getSelection();
      const dom = window.getSelection();
      const wrap = wrapRef.current;
      if (!$isRangeSelection(sel) || sel.isCollapsed() || !dom || dom.rangeCount === 0 || !wrap) {
        if (!editingLink.current) setBar(null);
        return;
      }
      const r = dom.getRangeAt(0).getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      const active = new Set<ComposerFormat>();
      for (const [f, t] of Object.entries(TEXT_FORMATS) as [ComposerFormat, TextFormatType][]) if (sel.hasFormat(t)) active.add(f);
      const block = sel.anchor.getNode().getTopLevelElement();
      if ($isHeadingNode(block) && ["h1", "h2", "h3"].includes(block.getTag())) active.add(block.getTag() as ComposerFormat);
      if ($isQuoteNode(block)) active.add("quote");
      if ($isListNode(block)) active.add("list");
      const link = $findMatchingParent(sel.anchor.getNode(), $isLinkNode);
      if (link) active.add("link");
      setBar({
        left: Math.max(170, Math.min(w.width - 170, r.left - w.left + r.width / 2)),
        top: r.top - w.top,
        active,
        link: link ? { key: link.getKey(), url: link.getURL() } : null,
      });
    });
  }), [editor, wrapRef]);

  const apply = (format: ComposerFormat) => {
    const on = bar?.active.has(format) ?? false;
    const text = TEXT_FORMATS[format];
    if (text) editor.dispatchCommand(FORMAT_TEXT_COMMAND, text);
    else if (format === "list") editor.dispatchCommand(on ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND, undefined);
    else if (format === "link") editor.dispatchCommand(TOGGLE_LINK_COMMAND, on ? null : "https://");
    else {
      editor.update(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        $setBlocksType(sel, () => {
          if (on) return $createParagraphNode();
          return format === "quote" ? $createQuoteNode() : $createHeadingNode(format as "h1" | "h2" | "h3");
        });
      });
    }
  };

  const setUrl = (url: string) => {
    if (!bar?.link) return;
    const { key } = bar.link;
    editor.update(() => {
      const node = $getNodeByKey(key);
      if ($isLinkNode(node)) node.setURL(url);
    });
    setBar({ ...bar, link: { key, url } });
  };

  return (
    <div className="chat-editor-format-anchor" style={lastAt.current}>
      <AnimatePresence>
        {bar && (
          <motion.div
            key="bar"
            className="chat-editor-format-bar"
            role="toolbar"
            aria-label="Format the selection"
            initial={{ opacity: 0, y: 6, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.94 }}
            transition={reduceMotion ? { duration: 0 } : spring}
          >
            <AnimatePresence>
              {bar.link && (
                <motion.div
                  key="link"
                  className="chat-editor-format-bar chat-editor-format-sub"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={reduceMotion ? { duration: 0 } : spring}
                >
                  <input
                    className="chat-editor-link-input"
                    type="url"
                    aria-label="Link address"
                    placeholder="Paste or type a link"
                    value={bar.link.url}
                    onMouseDown={() => { editingLink.current = true; }}
                    onBlur={() => { editingLink.current = false; }}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== "Escape") return;
                      e.preventDefault();
                      editingLink.current = false;
                      editor.focus();
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>
            {FORMAT_GROUPS.map((group, g) => (
              <div key={g} className="chat-editor-format-group">
                {group.map(({ format, label, Icon }) => (
                  <button
                    key={format}
                    type="button"
                    className="chat-editor-format-btn"
                    aria-label={label}
                    aria-pressed={bar.active.has(format)}
                    title={label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => apply(format)}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface LexicalChatEditorProps {
  placeholder?: string;
  disabled?: boolean;
  onSend: (markdown: string, files: File[]) => void;
  onChange?: () => void;
  confirmMassMention?: (text: string, send: () => void) => void;
}

/** The composer on Lexical, behind localStorage["gryt.lexicalComposer"] = "1" while we try it.
    No mentions, emoji or files yet: those still need the old composer. */
export const LexicalChatEditor = forwardRef<ChatEditorHandle, LexicalChatEditorProps>(
  ({ placeholder, disabled, onSend, onChange, confirmMassMention }, ref) => {
    const editorRef = useRef<LexicalEditor | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const hint = placeholder || "Type a message...";

    const markdown = () => {
      let md = "";
      editorRef.current?.getEditorState().read(() => { md = $convertToMarkdownString(TRANSFORMERS, undefined, true); });
      return md;
    };
    const setMarkdown = (text: string) => editorRef.current?.update(() => $convertFromMarkdownString(text, TRANSFORMERS, undefined, true));
    const clear = () => editorRef.current?.update(() => { $getRoot().clear(); });

    useImperativeHandle(ref, () => ({
      clear,
      focus: () => editorRef.current?.focus(),
      getMarkdown: markdown,
      getFiles: () => [],
      addFiles: () => {},
      setContent: setMarkdown,
      restore: ({ text }) => { if (!markdown().trim()) setMarkdown(text); },
    }));

    const send = () => {
      const text = markdown().trim();
      if (!text) return;
      const go = () => termsGate.postAfterAgreeing(() => {
        onSend(text, []);
        clear();
      });
      if (confirmMassMention && MASS_MENTION.test(text)) confirmMassMention(text, go);
      else go();
    };
    const sendRef = useRef(send);
    sendRef.current = send;
    const [onEnter] = useState(() => () => sendRef.current());

    return (
      <div className={`chat-editor-shell ${disabled ? "chat-editor-disabled" : ""}`}>
        <div ref={wrapRef} className="chat-editor-wrapper" style={{ position: "relative" }}>
          <LexicalComposer
            initialConfig={{
              namespace: "gryt-composer",
              nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode],
              theme: THEME,
              editable: !disabled,
              onError: (e) => { throw e; },
            }}
          >
            <EditorRefPlugin editorRef={editorRef} />
            <FormatBar wrapRef={wrapRef} />
            <div className="chat-editor-input-row">
              <div className="chat-editor-lexical-field">
              <RichTextPlugin
                contentEditable={
                  <ContentEditable
                    className="chat-editor-textarea chat-editor-lexical"
                    aria-placeholder={hint}
                    placeholder={<div className="chat-editor-lexical-placeholder">{hint}</div>}
                  />
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
              </div>
              <button className="chat-editor-send-btn" type="button" aria-label="Send message" disabled={disabled} onClick={send}>
                <PiArrowUpBold size={18} />
              </button>
            </div>
            <HistoryPlugin />
            <ListPlugin />
            <LinkPlugin />
            <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
            <EnterSends onEnter={onEnter} />
            {onChange && <OnChangePlugin ignoreSelectionChange onChange={() => onChange()} />}
          </LexicalComposer>
        </div>
      </div>
    );
  },
);

LexicalChatEditor.displayName = "LexicalChatEditor";
