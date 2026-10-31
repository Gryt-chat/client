import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $isListNode, INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, REMOVE_LIST_COMMAND } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $createHeadingNode, $createQuoteNode, $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $findMatchingParent } from "@lexical/utils";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  type TextFormatType,
} from "lexical";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { type ComposerFormat, FORMAT_GROUPS } from "./composerButtons";

const TEXT_FORMATS: Partial<Record<ComposerFormat, TextFormatType>> = { bold: "bold", italic: "italic", strike: "strikethrough", code: "code" };

const spring = { type: "spring", stiffness: 520, damping: 34 } as const;

type Bar = { active: Set<ComposerFormat>; link: { key: string; url: string } | null };

/** Shows while text is selected, always at the box's top left so it never jumps around. Every button
    toggles, and the selection stays so styles stack. */
export function ComposerFormatBar({ disabled }: { disabled?: boolean }) {
  const [editor] = useLexicalComposerContext();
  const [bar, setBar] = useState<Bar | null>(null);
  // Set on mousedown, before the box loses focus and the selection with it.
  const editingLink = useRef(false);
  // A link just added from the bar. Left without an address, it comes off again.
  const addingLink = useRef(false);
  const newLink = useRef<string | null>(null);

  const dropIfEmpty = useCallback((key: string | null) => {
    if (!key) return;
    newLink.current = null;
    editor.update(() => {
      const node = $getNodeByKey(key);
      if (!$isLinkNode(node) || !["", "https://"].includes(node.getURL().trim())) return;
      for (const child of node.getChildren()) node.insertBefore(child);
      node.remove();
    });
  }, [editor]);
  const reduceMotion = useReducedMotion();

  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel) || sel.isCollapsed()) {
        if (!editingLink.current) {
          setBar(null);
          const left = newLink.current;
          if (left) queueMicrotask(() => dropIfEmpty(left));
        }
        return;
      }
      const active = new Set<ComposerFormat>();
      for (const [f, t] of Object.entries(TEXT_FORMATS) as [ComposerFormat, TextFormatType][]) if (sel.hasFormat(t)) active.add(f);
      const block = sel.anchor.getNode().getTopLevelElement();
      if ($isHeadingNode(block) && ["h1", "h2", "h3"].includes(block.getTag())) active.add(block.getTag() as ComposerFormat);
      if ($isQuoteNode(block)) active.add("quote");
      const list = $findMatchingParent(sel.anchor.getNode(), $isListNode);
      if (list) active.add(list.getListType() === "number" ? "olist" : "list");
      const link = $findMatchingParent(sel.anchor.getNode(), $isLinkNode);
      if (link) active.add("link");
      if (link && addingLink.current) {
        addingLink.current = false;
        newLink.current = link.getKey();
      }
      const moved = newLink.current && newLink.current !== link?.getKey() && !editingLink.current ? newLink.current : null;
      if (moved) queueMicrotask(() => dropIfEmpty(moved));
      setBar({
        active,
        link: link ? { key: link.getKey(), url: link.getURL() } : null,
      });
    });
  }), [editor, dropIfEmpty]);

  const apply = (format: ComposerFormat) => {
    const on = bar?.active.has(format) ?? false;
    const text = TEXT_FORMATS[format];
    if (text) editor.dispatchCommand(FORMAT_TEXT_COMMAND, text);
    else if (format === "list") editor.dispatchCommand(on ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND, undefined);
    else if (format === "olist") editor.dispatchCommand(on ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined);
    else if (format === "link") {
      addingLink.current = !on;
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, on ? null : "https://");
    }
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
    <div className="chat-editor-format-anchor">
      <AnimatePresence>
        {bar && !disabled && (
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
                    onBlur={(e) => {
                      editingLink.current = false;
                      // Out of the composer altogether, not back into the text.
                      if (!editor.getRootElement()?.contains(e.relatedTarget as Node | null)) dropIfEmpty(newLink.current);
                    }}
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
                    // Keeps the selection in the box: a click would move focus and drop it.
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
