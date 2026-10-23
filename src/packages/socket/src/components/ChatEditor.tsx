import { Menu } from "@gryt/ui";
import { CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { mergeRegister } from "@lexical/utils";
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  FORMAT_TEXT_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  PASTE_COMMAND,
} from "lexical";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";

import { PiArrowUpBold, PiChartBarFill, PiCode, PiFileAudioFill, PiFileFill, PiFilePlusFill, PiFileTextFill, PiFileVideoFill, PiFileZipFill, PiImageFill, PiPlusBold, PiSmileyWinkFill, PiX } from "../../../../lib/icons";
import { termsGate } from "../../../../lib/termsGate";
const FaFilePdf = PiFileTextFill;

import { type EditorPill } from "../utils/chatEditorMentions";
import { type EmojiEntry, getCustomEmojis, recordRecentEmoji } from "../utils/emojiData";
import { MASS_MENTION } from "./composerButtons";
import { ComposerFormatBar } from "./ComposerFormatBar";
import { $createEmojiNode, $createMentionNode, $isMentionNode, composerTransformers, EmojiNode, MentionNode } from "./composerLexical";
import { EmojiAutocomplete } from "./EmojiAutocomplete";
import { EmojiPicker } from "./EmojiPicker";
import { emojiQueryAt } from "./emojiQuery";
import { MentionAutocomplete, type MentionMember } from "./MentionAutocomplete";

/**
 * The server's cap, mirrored so the counter and the send button can see it. Drift
 * low and the composer nags early; drift high and the send is refused.
 */
const MESSAGE_MAX_LENGTH = 4000;

/** Show the counter this far from the cap, not before. */
const COUNTER_VISIBLE_FROM = MESSAGE_MAX_LENGTH - 500;

/** A paste that cannot fit in one message becomes an ordinary text attachment. */
const LARGE_PASTE_FILE_NAME = "pasted-text.txt";

/** Said instead, where the attachment would be refused. */
const LONG_PASTE_NO_FILES =
  `That's too long to paste. Messages can be up to ${MESSAGE_MAX_LENGTH.toLocaleString("en")} characters, and you can't attach files here.`;

const THEME = {
  text: { bold: "lx-bold", italic: "lx-italic", strikethrough: "lx-strike", code: "lx-code" },
  heading: { h1: "lx-h1", h2: "lx-h2", h3: "lx-h3" },
  quote: "lx-quote",
  list: { ul: "lx-ul", ol: "lx-ol", listitem: "lx-li" },
  link: "gryt-link",
  code: "lx-codeblock",
  paragraph: "lx-p",
};

const NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, AutoLinkNode, CodeNode, MentionNode, EmojiNode];

const QUERY = { "@": /(^|[\s])@([a-zA-Z0-9_ ]*)$/, "#": /(^|[\s])#([a-zA-Z0-9_-]*)$/ } as const;

/** Where to draw the drop line on a staged file: before it, or after the last one. */
function dropMarker(dropAt: number | null, i: number, count: number): "before" | "after" | undefined {
  if (dropAt === i) return "before";
  return dropAt === i + 1 && i === count - 1 ? "after" : undefined;
}

export interface ChatEditorHandle {
  clear: () => void;
  focus: () => void;
  getMarkdown: () => string;
  getFiles: () => File[];
  addFiles: (files: FileList | File[]) => void;
  setContent: (text: string) => void;
  /** A message that did not go out: its files come back, and its text if the box is empty. */
  restore: (draft: { text: string; files: File[] }) => void;
}

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

interface ChatEditorProps {
  placeholder?: string;
  /** Board 5: going out in the clear, so the field is red. */
  unencrypted?: boolean;
  disabled?: boolean;
  /**
   * Whether attaching is offered at all. Separate from `disabled`: a role can be
   * allowed to talk and not to upload.
   */
  allowFiles?: boolean;
  maxFileSize?: number | null;
  onSend: (markdown: string, files: File[]) => void;
  /** Shown as Poll in the + menu where this server and channel take one (GRYT-1732). */
  onCreatePoll?: () => void;
  onArrowUpEmpty?: () => void;
  onCancel?: () => void;
  onTyping?: () => void;
  onStopTyping?: () => void;
  /** Anything in the box changed: text or files. */
  onChange?: () => void;
  isEditing?: boolean;
  memberList?: MentionMember[];
  /** Channels a `#` offers. Only ones this member can see. */
  channelList?: MentionMember[];
  serverHost?: string;
  /** Asked before a message with @everyone or @here goes out; it calls `send` to go ahead. */
  confirmMassMention?: (text: string, send: () => void) => void;
}

function getFileIcon(mime: string) {
  if (mime.startsWith("image/")) return <PiImageFill size={14} />;
  if (mime.startsWith("audio/")) return <PiFileAudioFill size={14} />;
  if (mime.startsWith("video/")) return <PiFileVideoFill size={14} />;
  if (mime === "application/pdf") return <FaFilePdf size={14} />;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar") || mime.includes("gzip") || mime.includes("compress")) return <PiFileZipFill size={14} />;
  if (mime.includes("javascript") || mime.includes("json") || mime.includes("xml") || mime.includes("html") || mime.includes("css") || mime.includes("typescript")) return <PiCode size={14} />;
  if (mime.startsWith("text/")) return <PiFileTextFill size={14} />;
  return <PiFileFill size={14} />;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Up to two thirds of the window while typing, so the messages above still show; one line otherwise. */
function autoResize(el: HTMLElement, open = document.activeElement === el) {
  const before = el.style.height;
  el.style.height = "auto";
  const full = el.scrollHeight;
  const style = getComputedStyle(el);
  const oneLine = parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const target = open ? Math.min(full, window.innerHeight * 0.66) : Math.min(full, oneLine);
  // Back to where it was first, so the height animates rather than jumps.
  el.style.height = before;
  void el.offsetHeight;
  el.style.height = `${target}px`;
  if (!open) el.scrollTop = 0;
  el.toggleAttribute("data-collapsed", !open && full > oneLine);
}

/** The pill a pick turns into. @everyone and @here stay text, as the old box sent them. */
function pillFor(member: MentionMember): EditorPill {
  if (member.kind === "channel" && member.channelId) return { dataset: { channelId: member.channelId }, text: `#${member.nickname}` };
  if (member.kind === "role" && member.roleId) return { dataset: { roleId: member.roleId, mentionName: `@${member.nickname}` }, text: `@${member.nickname}` };
  // Shown, never sent: the stored label stays the name, from `mentionName`.
  return {
    dataset: { mentionId: member.serverUserId, mentionName: `@${member.nickname}` },
    text: member.tag ? `@${member.nickname} ${member.tag}` : `@${member.nickname}`,
  };
}

/** The text before and after the caret, when it sits in plain text. */
function $caretText(): { node: LexicalNode; before: string; after: string; offset: number } | null {
  const sel = $getSelection();
  if (!$isRangeSelection(sel) || !sel.isCollapsed()) return null;
  const node = sel.anchor.getNode();
  if (!$isTextNode(node) || $isMentionNode(node)) return null;
  const text = node.getTextContent();
  return { node, before: text.slice(0, sel.anchor.offset), after: text.slice(sel.anchor.offset), offset: sel.anchor.offset };
}

/** Replaces the typed query ending at the caret with `nodes`. */
function $replaceQuery(start: (before: string) => number | null, nodes: LexicalNode[]) {
  const at = $caretText();
  const sel = $getSelection();
  if (!at || !$isRangeSelection(sel)) return;
  const from = start(at.before);
  if (from === null) return;
  sel.anchor.set(at.node.getKey(), from, "text");
  sel.focus.set(at.node.getKey(), at.offset, "text");
  sel.insertNodes(nodes);
}

export const ChatEditor = forwardRef<ChatEditorHandle, ChatEditorProps>(
  ({ placeholder, unencrypted, disabled, allowFiles, maxFileSize, onSend, onCreatePoll, onArrowUpEmpty, onCancel, onTyping, onStopTyping, onChange, isEditing, memberList, channelList, serverHost, confirmMassMention }, ref) => {
    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [dropAt, setDropAt] = useState<number | null>(null);
    /** Moves a staged file from one place to another; `to` counts gaps, 0 is before the first. */
    const moveFile = (from: number, to: number) => {
      setPendingFiles((files) => {
        const next = [...files];
        const [moved] = next.splice(from, 1);
        next.splice(to > from ? to - 1 : to, 0, moved);
        return next;
      });
      setDragFrom(null);
      setDropAt(null);
    };
    const pendingFilesRef = useRef<PendingFile[]>([]);
    pendingFilesRef.current = pendingFiles;

    const editorRef = useRef<LexicalEditor | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const onSendRef = useRef(onSend);
    onSendRef.current = onSend;
    const confirmMassRef = useRef(confirmMassMention);
    confirmMassRef.current = confirmMassMention;
    const onTypingRef = useRef(onTyping);
    onTypingRef.current = onTyping;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    // A file added, removed or sent counts as a change too.
    useEffect(() => onChangeRef.current?.(), [pendingFiles]);
    const onStopTypingRef = useRef(onStopTyping);
    onStopTypingRef.current = onStopTyping;
    const channelListRef = useRef(channelList);
    channelListRef.current = channelList;

    const transformers = useMemo(
      () => composerTransformers((id) => channelListRef.current?.find((c) => c.channelId === id)?.nickname ?? null),
      [],
    );

    const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [channelQuery, setChannelQuery] = useState<string | null>(null);
    const showAutocomplete = emojiQuery !== null;
    const showMentionAutocomplete = mentionQuery !== null;
    const [length, setLength] = useState(0);

    const getText = useCallback(() => {
      let md = "";
      editorRef.current?.getEditorState().read(() => { md = $convertToMarkdownString(transformers, undefined, true); });
      return md;
    }, [transformers]);

    const clearText = useCallback(() => {
      editorRef.current?.update(() => { $getRoot().clear(); });
      setLength(0);
    }, []);

    const handleSend = useCallback(() => {
      const text = getText().trim();
      const files = pendingFilesRef.current.map((p) => p.file);

      if (!text && files.length === 0) return;
      // The server refuses this too. Stopping here keeps the message in the box,
      // where it can be edited down, rather than bounced with the text cleared.
      if (text.length > MESSAGE_MAX_LENGTH) return;

      // Until this device has agreed to the terms, the draft stays in the box while it asks.
      const send = () => termsGate.postAfterAgreeing(() => {
        onSendRef.current(text, files);
        clearText();
        pendingFilesRef.current.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
        setPendingFiles([]);
        setEmojiQuery(null);
        setMentionQuery(null);
        setChannelQuery(null);
        onStopTypingRef.current?.();
      });
      if (confirmMassRef.current && MASS_MENTION.test(text)) confirmMassRef.current(text, send);
      else send();
    }, [getText, clearText]);

    const addFiles = useCallback((files: FileList | File[]) => {
      // Covers paste and drag-and-drop as well as the clip, which is why it is
      // here rather than only on the button.
      if (allowFiles === false) {
        toast.error("You do not have permission to attach files here.");
        return;
      }
      for (const file of files) {
        if (maxFileSize && file.size > maxFileSize) {
          const limitMb = (maxFileSize / (1024 * 1024)).toFixed(0);
          toast.error(`File "${file.name}" is too large. Max file size is ${limitMb} MB.`);
          continue;
        }
        const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
        const id = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setPendingFiles((prev) => [...prev, { id, file, previewUrl }]);
      }
    }, [maxFileSize, allowFiles]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        // A suggestion list that used the key prevented it first. An empty one lets it through.
        if (e.defaultPrevented) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
          return;
        }
        if (e.key === "Escape" && isEditing && onCancel) {
          // Calling off an edit is the innermost thing Escape can mean here.
          e.preventDefault();
          e.stopPropagation();
          onCancel();
          return;
        }
        if (e.key === "ArrowUp" && !isEditing && onArrowUpEmpty) {
          if (!getText().trim() && pendingFilesRef.current.length === 0) {
            e.preventDefault();
            onArrowUpEmpty();
          }
        }
      },
      [handleSend, isEditing, onCancel, onArrowUpEmpty, getText]
    );
    const handleKeyDownRef = useRef(handleKeyDown);
    handleKeyDownRef.current = handleKeyDown;

    const handlePaste = useCallback((e: ClipboardEvent): boolean => {
      const items = e.clipboardData?.items;
      if (!items) return false;

      const filesToAdd: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) filesToAdd.push(file);
        }
      }
      e.preventDefault();
      if (filesToAdd.length > 0) {
        addFiles(filesToAdd);
        return true;
      }

      const text = e.clipboardData?.getData("text/plain");
      if (!text) return true;

      // Oversized text is unsendable and slows the editor down.
      // Keep it out of the box and attach the exact clipboard contents instead.
      if (text.length > MESSAGE_MAX_LENGTH) {
        if (isEditing) {
          toast.error(`Edited messages are limited to ${MESSAGE_MAX_LENGTH.toLocaleString("en")} characters.`);
          return true;
        }
        // The file below would be refused, and the paste gone with it.
        if (allowFiles === false) {
          toast.error(LONG_PASTE_NO_FILES);
          return true;
        }
        addFiles([new File([text], LARGE_PASTE_FILE_NAME, { type: "text/plain;charset=utf-8" })]);
        return true;
      }

      // Plain text, as before: a web page's formatting doesn't come along.
      editorRef.current?.update(() => {
        const sel = $getSelection();
        if ($isRangeSelection(sel)) sel.insertRawText(text);
      });
      return true;
    }, [addFiles, isEditing, allowFiles]);
    const handlePasteRef = useRef(handlePaste);
    handlePasteRef.current = handlePaste;
    const addFilesRef = useRef(addFiles);
    addFilesRef.current = addFiles;

    /** What the caret is typing: a channel, a mention or an emoji shortcode. */
    const updateQueries = useCallback(() => {
      editorRef.current?.getEditorState().read(() => {
        const at = $caretText();
        const word = at && !/^[a-zA-Z0-9_]/.test(at.after);
        const cq = word ? at.before.match(QUERY["#"])?.[2] ?? null : null;
        const mq = word && cq === null ? at.before.match(QUERY["@"])?.[2] ?? null : null;
        const eq = at && cq === null && mq === null ? emojiQueryAt(at.before + at.after, at.offset)?.name ?? null : null;
        setChannelQuery(cq);
        setMentionQuery(mq);
        setEmojiQuery(eq);
      });
    }, []);

    // Commands and listeners, once the editor exists. EditorRefPlugin sets it in an effect that runs before this one.
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const strike = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "x";
      return mergeRegister(
        editor.registerCommand(KEY_DOWN_COMMAND, (e) => {
          if (strike(e)) {
            e.preventDefault();
            editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough");
            return true;
          }
          handleKeyDownRef.current(e);
          return e.defaultPrevented;
        }, COMMAND_PRIORITY_HIGH),
        // A new paragraph, not a <br>: `# ` and `- ` only become blocks at the start of one.
        editor.registerCommand(KEY_ENTER_COMMAND, (e) => {
          if (!e?.shiftKey) return false;
          e.preventDefault();
          editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
          return true;
        }, COMMAND_PRIORITY_HIGH),
        editor.registerCommand(PASTE_COMMAND, (e) => (e instanceof ClipboardEvent ? handlePasteRef.current(e) : false), COMMAND_PRIORITY_HIGH),
        editor.registerCommand(DROP_COMMAND, (e) => {
          const files = e.dataTransfer?.files;
          if (!files || files.length === 0) return false;
          e.preventDefault();
          e.stopPropagation();
          addFilesRef.current(files);
          return true;
        }, COMMAND_PRIORITY_HIGH),
        editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
          updateQueries();
          if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
          const root = editor.getRootElement();
          if (root) autoResize(root);
          const body = getText().trim();
          setLength(body.length);
          onChangeRef.current?.();
          if (body.length > 0) onTypingRef.current?.();
          else onStopTypingRef.current?.();
        }),
      );
    }, [getText, updateQueries]);

    useEffect(() => { editorRef.current?.setEditable(!disabled); }, [disabled]);

    // Nodes can only be made inside an update, hence the factory.
    const insertAtCaret = useCallback((make: () => LexicalNode[]) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.update(() => {
        let sel = $getSelection();
        if (!$isRangeSelection(sel)) {
          $getRoot().selectEnd();
          sel = $getSelection();
        }
        if ($isRangeSelection(sel)) sel.insertNodes(make());
      });
    }, []);

    const handleEmojiSelect = useCallback((entry: EmojiEntry) => {
      const { emoji, url, name } = entry;
      if (!emoji && !url) return;
      editorRef.current?.update(() => {
        const nodes = emoji ? [$createTextNode(`${emoji} `)] : [$createEmojiNode(name, url ?? "", false), $createTextNode(" ")];
        $replaceQuery((before) => emojiQueryAt(before, before.length)?.start ?? null, nodes);
      });
      recordRecentEmoji(entry.name, entry.isCustom, serverHost);
      setEmojiQuery(null);
    }, [serverHost]);

    const handleMentionSelect = useCallback((member: MentionMember) => {
      editorRef.current?.update(() => {
        const lead = (before: string) => {
          const m = before.match(QUERY["@"]);
          return m ? before.length - m[0].length + m[1].length : null;
        };
        const mass = member.kind === "everyone" || member.kind === "here";
        $replaceQuery(lead, mass ? [$createTextNode(`@${member.kind} `)] : [$createMentionNode(pillFor(member)), $createTextNode(" ")]);
      });
      setMentionQuery(null);
    }, []);

    const handleChannelSelect = useCallback((channel: MentionMember) => {
      editorRef.current?.update(() => {
        const lead = (before: string) => {
          const m = before.match(QUERY["#"]);
          return m ? before.length - m[0].length + m[1].length : null;
        };
        $replaceQuery(lead, [$createMentionNode(pillFor(channel)), $createTextNode(" ")]);
      });
      setChannelQuery(null);
    }, []);

    const handlePickerEmojiSelect = useCallback((src: string) => {
      const other = /^!\[:([a-zA-Z0-9_+-]+):\]\((https?:\/\/[^)\s]+)\)$/.exec(src);
      if (other) {
        insertAtCaret(() => [$createEmojiNode(other[1], other[2], true), $createTextNode(" ")]);
      } else if (src.startsWith(":") && src.endsWith(":")) {
        const name = src.slice(1, -1);
        const custom = getCustomEmojis().find((e) => e.name === name);
        if (custom?.url) {
          const url = custom.url;
          insertAtCaret(() => [$createEmojiNode(name, url, false), $createTextNode(" ")]);
          recordRecentEmoji(name, true, serverHost);
        }
      } else {
        insertAtCaret(() => [$createTextNode(`${src} `)]);
      }
      setEmojiPickerOpen(false);
    }, [serverHost, insertAtCaret]);

    const setContent = useCallback((text: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.update(() => {
        $convertFromMarkdownString(text, transformers, undefined, true);
        $getRoot().selectEnd();
      });
      setLength(text.trim().length);
      onChangeRef.current?.();
      editor.focus();
    }, [transformers]);

    useImperativeHandle(ref, () => ({
      clear: () => {
        clearText();
        pendingFiles.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
        setPendingFiles([]);
      },
      focus: () => editorRef.current?.focus(),
      getMarkdown: getText,
      getFiles: () => pendingFiles.map((p) => p.file),
      addFiles,
      setContent,
      restore: ({ text, files }) => {
        // Whatever was typed since the send stays, and the files join it.
        if (text && !getText().trim()) setContent(text);
        else editorRef.current?.focus();
        if (files.length > 0) addFiles(files);
      },
    }));

    const removeFile = useCallback((id: string) => {
      setPendingFiles((prev) => {
        const f = prev.find((p) => p.id === id);
        if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
        return prev.filter((p) => p.id !== id);
      });
    }, []);

    useEffect(() => {
      const onMentionUser = (e: Event) => {
        const { serverUserId: id, nickname: name } = (e as CustomEvent<{ serverUserId: string; nickname: string }>).detail;
        const editor = editorRef.current;
        if (!editor || !id) return;
        editor.focus();
        editor.update(() => {
          $getRoot().selectEnd();
          const sel = $getSelection();
          if ($isRangeSelection(sel)) {
            sel.insertNodes([$createMentionNode({ dataset: { mentionId: id, mentionName: `@${name}` }, text: `@${name}` }), $createTextNode(" ")]);
          }
        });
      };
      window.addEventListener("mention_user", onMentionUser);
      return () => window.removeEventListener("mention_user", onMentionUser);
    }, []);

    useEffect(() => {
      return () => {
        pendingFilesRef.current.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
      };
    }, []);

    const hint = placeholder || "Type a message...";
    const canSend = length > 0 || pendingFiles.length > 0;
    return (
      <div className={`chat-editor-shell ${disabled ? "chat-editor-disabled" : ""}`}>
        {/* The phone's + menu, outside the field (GRYT-1722). */}
        {(allowFiles !== false || onCreatePoll) && (
          <Menu.Root>
            <Menu.Trigger
              render={<button className="chat-editor-plus-btn" type="button" aria-label="Add" disabled={disabled} />}
            >
              <PiPlusBold size={20} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="top" align="start" sideOffset={8}>
                <Menu.Popup className="chat-editor-plus-menu">
                  {allowFiles !== false && (
                    <Menu.Item onClick={() => fileInputRef.current?.click()}>
                      <span className="chat-editor-plus-icon" data-accent><PiFilePlusFill size={18} /></span>
                      Attach files
                    </Menu.Item>
                  )}
                  {onCreatePoll && (
                    <Menu.Item onClick={onCreatePoll}>
                      <span className="chat-editor-plus-icon" data-accent><PiChartBarFill size={18} /></span>
                      Poll
                    </Menu.Item>
                  )}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        )}
      <div ref={wrapperRef} className="chat-editor-wrapper" data-unencrypted={unencrypted ? "" : undefined} style={{ position: "relative" }}>
        {pendingFiles.length > 0 && (
          <div className="chat-editor-file-preview-bar">
            {/* Drag a file left or right to change the order it's sent in (GRYT-1722 draft). */}
            {pendingFiles.map((pf, i) => (
              <div
                key={pf.id}
                className="chat-editor-file-preview"
                draggable={pendingFiles.length > 1}
                data-dragging={dragFrom === i || undefined}
                data-drop={dropMarker(dropAt, i, pendingFiles.length)}
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("application/x-gryt-staged", String(i));
                }}
                onDragOver={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
                }}
                onDrop={(e) => {
                  if (dragFrom === null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  moveFile(dragFrom, dropAt ?? i);
                }}
                onDragEnd={() => { setDragFrom(null); setDropAt(null); }}
              >
                {pf.previewUrl ? (
                  <img src={pf.previewUrl} alt="Upload preview" />
                ) : (
                  <div className="chat-editor-file-preview-icon">
                    {getFileIcon(pf.file.type)}
                  </div>
                )}
                <div className="chat-editor-file-preview-info">
                  <span className="chat-editor-file-preview-name" title={pf.file.name}>{pf.file.name}</span>
                  <span className="chat-editor-file-preview-size">{formatFileSize(pf.file.size)}</span>
                </div>
                <button
                  className="chat-editor-file-delete"
                  onClick={() => removeFile(pf.id)}
                  type="button"
                  aria-label="Remove file"
                >
                  <PiX size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <EmojiAutocomplete
          query={emojiQuery || ""}
          visible={showAutocomplete}
          onSelect={handleEmojiSelect}
          onClose={() => setEmojiQuery(null)}
          serverHost={serverHost}
        />
        <MentionAutocomplete
          query={mentionQuery || ""}
          visible={showMentionAutocomplete}
          members={memberList || []}
          onSelect={handleMentionSelect}
          onClose={() => setMentionQuery(null)}
        />
        <MentionAutocomplete
          query={channelQuery || ""}
          visible={channelQuery !== null}
          members={channelList || []}
          onSelect={handleChannelSelect}
          onClose={() => setChannelQuery(null)}
          title="Channels"
        />
        <LexicalComposer
          initialConfig={{
            namespace: "gryt-composer",
            nodes: NODES,
            theme: THEME,
            editable: !disabled,
            onError: (e) => { throw e; },
          }}
        >
          <EditorRefPlugin editorRef={editorRef} />
          <ComposerFormatBar wrapRef={wrapperRef} disabled={disabled} />
          <div className="chat-editor-input-row">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <div className="chat-editor-lexical-field">
              <RichTextPlugin
                contentEditable={
                  <ContentEditable
                    className="chat-editor-textarea chat-editor-lexical"
                    aria-placeholder={hint}
                    placeholder={<div className="chat-editor-lexical-placeholder">{hint}</div>}
                    onFocus={(e) => autoResize(e.currentTarget, true)}
                    onBlur={(e) => {
                      // Into the link field is still writing this message.
                      if (!wrapperRef.current?.contains(e.relatedTarget as Node | null)) autoResize(e.currentTarget, false);
                    }}
                  />
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </div>
            {length >= COUNTER_VISIBLE_FROM && (
              <span
                className="chat-editor-counter"
                data-over={length > MESSAGE_MAX_LENGTH ? "true" : undefined}
                /* Polite: it updates on every keystroke near the cap, and an
                   assertive live region would interrupt the typing it counts. */
                aria-live="polite"
              >
                {(MESSAGE_MAX_LENGTH - length).toLocaleString("en")}
              </span>
            )}
            <div style={{ position: "relative" }}>
              <button
                className="chat-editor-emoji-btn"
                type="button"
                aria-label="Insert emoji"
                disabled={disabled}
                onClick={() => setEmojiPickerOpen((v) => !v)}
              >
                <PiSmileyWinkFill size={20} />
              </button>
              {emojiPickerOpen && (
                <EmojiPicker
                  onSelect={handlePickerEmojiSelect}
                  onClose={() => setEmojiPickerOpen(false)}
                  serverHost={serverHost}
                  withOtherServers
                />
              )}
            </div>
            {/* Round, and only once there is something to send. Enter still sends. */}
            {canSend && (
              <button
                className="chat-editor-send-btn"
                type="button"
                aria-label="Send message"
                disabled={disabled}
                onClick={handleSend}
              >
                <PiArrowUpBold size={18} />
              </button>
            )}
          </div>
          <HistoryPlugin />
          <ListPlugin />
          <LinkPlugin />
          <MarkdownShortcutPlugin transformers={transformers} />
        </LexicalComposer>
      </div>
      </div>
    );
  }
);

ChatEditor.displayName = "ChatEditor";
