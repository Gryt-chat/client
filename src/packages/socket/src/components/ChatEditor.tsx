import { Menu } from "@gryt/ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";

import { PiArrowUpBold, PiChartBarFill, PiCode, PiFileAudioFill, PiFileFill, PiFilePlusFill, PiFileTextFill, PiFileVideoFill, PiFileZipFill, PiImageFill, PiLinkSimpleBold, PiListBulletsBold, PiPlusBold, PiQuotesBold, PiSmileyWinkFill, PiTextBBold, PiTextHOneBold, PiTextHThreeBold, PiTextHTwoBold, PiTextItalicBold, PiTextStrikethroughBold, PiX } from "../../../../lib/icons";
import { termsGate } from "../../../../lib/termsGate";
const FaFilePdf = PiFileTextFill;

import { channelHref } from "../../../lib/mentionTokens";
import { parseEditSegments } from "../utils/chatEditorMentions";
import { type EmojiEntry, getCustomEmojis, recordRecentEmoji } from "../utils/emojiData";
import {
  activeComposerFormats,
  applyComposerFormat,
  type ComposerFormat,
  selectComposerLinkText,
  selectedLink,
  setComposerLinkUrl,
} from "./composerFormat";
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

const MASS_MENTION = /(^|\s)@(everyone|here)\b/;

type FormatButton = { format: ComposerFormat; label: string; Icon: typeof PiCode };

/** In groups, with a gap between, so text styles, code and links, headings and blocks read apart. */
const FORMAT_GROUPS: FormatButton[][] = [
  [
    { format: "bold", label: "Bold (Ctrl+B)", Icon: PiTextBBold },
    { format: "italic", label: "Italic (Ctrl+I)", Icon: PiTextItalicBold },
    { format: "strike", label: "Strikethrough (Ctrl+Shift+X)", Icon: PiTextStrikethroughBold },
  ],
  [
    { format: "code", label: "Code", Icon: PiCode },
    { format: "link", label: "Link", Icon: PiLinkSimpleBold },
  ],
  [
    { format: "h1", label: "Heading 1", Icon: PiTextHOneBold },
    { format: "h2", label: "Heading 2", Icon: PiTextHTwoBold },
    { format: "h3", label: "Heading 3", Icon: PiTextHThreeBold },
  ],
  [
    { format: "list", label: "List", Icon: PiListBulletsBold },
    { format: "quote", label: "Quote", Icon: PiQuotesBold },
  ],
];

const SHORTCUTS: Record<string, ComposerFormat | undefined> = { b: "bold", i: "italic", "shift+x": "strike" };

/** A paste that cannot fit in one message becomes an ordinary text attachment. */
const LARGE_PASTE_FILE_NAME = "pasted-text.txt";

/** Said instead, where the attachment would be refused. */
const LONG_PASTE_NO_FILES =
  `That's too long to paste. Messages can be up to ${MESSAGE_MAX_LENGTH.toLocaleString("en")} characters, and you can't attach files here.`;

/** Where the drop line goes on a staged file: before it, or after the last one. */
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

function serializeContentEditable(el: HTMLElement): string {
  let result = "";
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as HTMLElement;
      if (elem.tagName === "IMG" && elem.dataset.emojiName) {
        // Another server's emoji goes as its image; its name only resolves on its own server.
        result += elem.dataset.emojiSrc ? `![:${elem.dataset.emojiName}:](${elem.dataset.emojiSrc})` : `:${elem.dataset.emojiName}:`;
      } else if (elem.dataset.roleId) {
        result += `[${elem.dataset.mentionName || elem.textContent || ""}](role:${elem.dataset.roleId})`;
      } else if (elem.dataset.channelId) {
        // Never the name: a reader who can't see the channel must not get it.
        result += `[#channel](${channelHref(elem.dataset.channelId, elem.dataset.channelHost || null)})`;
      } else if (elem.dataset.mentionId) {
        const id = elem.dataset.mentionId;
        const name = elem.dataset.mentionName || elem.textContent || "";
        result += `[${name}](mention:${id})`;
      } else if (elem.tagName === "BR") {
        result += "\n";
      } else if (elem.tagName === "DIV" || elem.tagName === "P") {
        if (result.length > 0 && !result.endsWith("\n")) result += "\n";
        result += serializeContentEditable(elem);
      } else {
        result += serializeContentEditable(elem);
      }
    }
  }
  return result;
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

function getEmojiQueryAtCursor(): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  return emojiQueryAt(node.textContent || "", range.startOffset)?.name ?? null;
}

const QUERY = { "@": /(^|[\s])@([a-zA-Z0-9_ ]*)$/, "#": /(^|[\s])#([a-zA-Z0-9_-]*)$/ } as const;

function getQueryAtCursor(trigger: "@" | "#"): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent || "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);

  const match = before.match(QUERY[trigger]);
  if (!match) return null;

  const afterCursor = text.slice(offset);
  if (afterCursor.length > 0 && /^[a-zA-Z0-9_]/.test(afterCursor)) return null;

  return match[2];
}

/** The pill a pick turns into, or plain text for @everyone and @here. */
function mentionNode(member: MentionMember): Node {
  if (member.kind === "everyone" || member.kind === "here") return document.createTextNode(`@${member.kind}`);
  const pill = document.createElement("span");
  pill.className = "chat-editor-mention";
  if (member.kind === "channel" && member.channelId) {
    pill.dataset.channelId = member.channelId;
    pill.textContent = `#${member.nickname}`;
  } else if (member.kind === "role" && member.roleId) {
    pill.dataset.roleId = member.roleId;
    pill.dataset.mentionName = `@${member.nickname}`;
    pill.textContent = `@${member.nickname}`;
  } else {
    pill.dataset.mentionId = member.serverUserId;
    pill.dataset.mentionName = `@${member.nickname}`;
    // Shown, never sent: the stored label stays the name, from `mentionName`.
    pill.textContent = member.tag ? `@${member.nickname} ${member.tag}` : `@${member.nickname}`;
  }
  pill.contentEditable = "false";
  pill.draggable = false;
  return pill;
}

function replaceQueryAtCursor(trigger: "@" | "#", member: MentionMember): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;

  const text = node.textContent || "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);

  const match = before.match(QUERY[trigger]);
  if (!match) return;

  const atStart = offset - match[0].length + match[1].length;

  const replaceRange = document.createRange();
  replaceRange.setStart(node, atStart);
  replaceRange.setEnd(node, offset);
  replaceRange.deleteContents();

  const trailing = document.createTextNode(" ");
  replaceRange.insertNode(trailing);
  replaceRange.insertNode(mentionNode(member));

  sel.removeAllRanges();
  const newRange = document.createRange();
  newRange.setStartAfter(trailing);
  newRange.collapse(true);
  sel.addRange(newRange);
}

function replaceEmojiQueryAtCursor(entry: EmojiEntry): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;

  const offset = range.startOffset;
  const query = emojiQueryAt(node.textContent || "", offset);
  if (!query) return;

  const replaceRange = document.createRange();
  replaceRange.setStart(node, query.start);
  replaceRange.setEnd(node, offset);
  replaceRange.deleteContents();

  if (entry.emoji) {
    const textNode = document.createTextNode(entry.emoji + " ");
    replaceRange.insertNode(textNode);
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartAfter(textNode);
    newRange.collapse(true);
    sel.addRange(newRange);
  } else if (entry.url) {
    const img = document.createElement("img");
    img.src = entry.url;
    img.alt = `:${entry.name}:`;
    img.dataset.emojiName = entry.name;
    img.className = "inline-emoji";
    img.draggable = false;
    img.contentEditable = "false";
    const space = document.createTextNode(" ");
    replaceRange.insertNode(space);
    replaceRange.insertNode(img);
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.setStartAfter(space);
    newRange.collapse(true);
    sel.addRange(newRange);
  }
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

    const editorRef = useRef<HTMLDivElement>(null);
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

    const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
    const [showAutocomplete, setShowAutocomplete] = useState(false);
    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [selectionBar, setSelectionBar] = useState<{
      left: number;
      top: number;
      active: Set<ComposerFormat>;
      link: { urlStart: number; urlEnd: number; url: string } | null;
    } | null>(null);
    // While its field has focus the selection is in the field, which would otherwise close the bar.
    const editingLinkRef = useRef(false);
    // Where the bar last was, so it can fade out there rather than jump.
    const lastBarAt = useRef({ left: 0, top: 0 });
    const reduceMotion = useReducedMotion();
    if (selectionBar) lastBarAt.current = { left: selectionBar.left, top: selectionBar.top };

    useEffect(() => {
      const onSelectionChange = () => {
        const el = editorRef.current;
        const wrap = wrapperRef.current;
        const sel = window.getSelection();
        if (!el || !wrap || !sel || sel.isCollapsed || !el.contains(sel.anchorNode) || !el.contains(sel.focusNode)) {
          if (!editingLinkRef.current) setSelectionBar(null);
          return;
        }
        const r = sel.getRangeAt(0).getBoundingClientRect();
        const w = wrap.getBoundingClientRect();
        const centre = r.left - w.left + r.width / 2;
        setSelectionBar({
          left: Math.max(150, Math.min(w.width - 150, centre)),
          top: r.top - w.top,
          active: activeComposerFormats(el),
          link: selectedLink(el),
        });
      };
      document.addEventListener("selectionchange", onSelectionChange);
      return () => document.removeEventListener("selectionchange", onSelectionChange);
    }, []);

    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [showMentionAutocomplete, setShowMentionAutocomplete] = useState(false);
    const [channelQuery, setChannelQuery] = useState<string | null>(null);

    const updateAutocompleteQueries = useCallback(() => {
      const cq = getQueryAtCursor("#");
      setChannelQuery(cq);
      if (cq !== null) {
        setShowMentionAutocomplete(false);
        setShowAutocomplete(false);
        return;
      }
      const mq = getQueryAtCursor("@");
      if (mq !== null) {
        setMentionQuery(mq);
        setShowMentionAutocomplete(true);
        setEmojiQuery(null);
        setShowAutocomplete(false);
        return;
      }
      setMentionQuery(null);
      setShowMentionAutocomplete(false);

      const eq = getEmojiQueryAtCursor();
      setEmojiQuery(eq);
      setShowAutocomplete(eq !== null);
    }, []);

    const [length, setLength] = useState(0);

    const handleSend = useCallback(() => {
      const el = editorRef.current;
      if (!el) return;

      const text = serializeContentEditable(el).trim();
      const files = pendingFilesRef.current.map((p) => p.file);

      if (!text && files.length === 0) return;
      // The server refuses this too. Stopping here keeps the message in the box,
      // where it can be edited down, rather than bounced with the text cleared.
      if (text.length > MESSAGE_MAX_LENGTH) return;

      // Until this device has agreed to the terms, the draft stays in the box while it asks.
      const send = () => termsGate.postAfterAgreeing(() => {
        onSendRef.current(text, files);
        el.textContent = "";
        autoResize(el);
        pendingFilesRef.current.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
        setPendingFiles([]);
        setShowAutocomplete(false);
        setEmojiQuery(null);
        setShowMentionAutocomplete(false);
        setMentionQuery(null);
        setChannelQuery(null);
        onStopTypingRef.current?.();
      });
      if (confirmMassRef.current && MASS_MENTION.test(text)) confirmMassRef.current(text, send);
      else send();
    }, []);

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
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        // A suggestion list that used the key prevented it first. An empty one lets it through.
        if (e.nativeEvent.defaultPrevented) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
          return;
        }
        const shortcut = (e.ctrlKey || e.metaKey) && !e.altKey
          ? SHORTCUTS[`${e.shiftKey ? "shift+" : ""}${e.key.toLowerCase()}`]
          : undefined;
        if (shortcut && editorRef.current) {
          // The browser's own Ctrl+B adds <b>, which the message never carries.
          e.preventDefault();
          applyComposerFormat(editorRef.current, shortcut);
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
          const el = editorRef.current;
          const text = el ? serializeContentEditable(el).trim() : "";
          if (!text && pendingFilesRef.current.length === 0) {
            e.preventDefault();
            onArrowUpEmpty();
          }
        }
      },
      [handleSend, isEditing, onCancel, onArrowUpEmpty]
    );

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLDivElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const filesToAdd: File[] = [];
        for (const item of items) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (file) filesToAdd.push(file);
          }
        }
        if (filesToAdd.length > 0) {
          e.preventDefault();
          addFiles(filesToAdd);
          return;
        }

        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        if (!text) return;

        // Oversized text is unsendable and can freeze contentEditable.
        // Keep it out of the DOM and attach the exact clipboard contents instead.
        if (text.length > MESSAGE_MAX_LENGTH) {
          if (isEditing) {
            toast.error(
              `Edited messages are limited to ${MESSAGE_MAX_LENGTH.toLocaleString("en")} characters.`,
            );
            return;
          }
          // The file below would be refused, and the paste gone with it.
          if (allowFiles === false) {
            toast.error(LONG_PASTE_NO_FILES);
            return;
          }

          addFiles([
            new File([text], LARGE_PASTE_FILE_NAME, {
              type: "text/plain;charset=utf-8",
            }),
          ]);
          return;
        }

        document.execCommand("insertText", false, text);
      },
      [addFiles, isEditing, allowFiles]
    );

    const handleDrop = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        addFiles(files);
      },
      [addFiles]
    );

    const handleInput = useCallback(() => {
      if (editorRef.current) autoResize(editorRef.current);
      updateAutocompleteQueries();
      const body = editorRef.current ? serializeContentEditable(editorRef.current).trim() : "";
      setLength(body.length);
      onChangeRef.current?.();
      if (body.length > 0) {
        onTypingRef.current?.();
      } else {
        onStopTypingRef.current?.();
      }
    }, [updateAutocompleteQueries]);

    const handleEmojiSelect = useCallback((entry: EmojiEntry) => {
      replaceEmojiQueryAtCursor(entry);
      recordRecentEmoji(entry.name, entry.isCustom, serverHost);
      setShowAutocomplete(false);
      setEmojiQuery(null);
      if (editorRef.current) autoResize(editorRef.current);
    }, [serverHost]);

    const handleAutocompleteClose = useCallback(() => {
      setShowAutocomplete(false);
      setEmojiQuery(null);
    }, []);

    const handleChannelSelect = useCallback((channel: MentionMember) => {
      replaceQueryAtCursor("#", channel);
      setChannelQuery(null);
      if (editorRef.current) autoResize(editorRef.current);
    }, []);

    const handleMentionSelect = useCallback((member: MentionMember) => {
      replaceQueryAtCursor("@", member);
      setShowMentionAutocomplete(false);
      setMentionQuery(null);
      if (editorRef.current) autoResize(editorRef.current);
    }, []);

    const handleMentionAutocompleteClose = useCallback(() => {
      setShowMentionAutocomplete(false);
      setMentionQuery(null);
    }, []);

    const handlePickerEmojiSelect = useCallback((src: string) => {
      const el = editorRef.current;
      if (!el) return;

      el.focus();
      const sel = window.getSelection();

      const other = /^!\[:([a-zA-Z0-9_+-]+):\]\((https?:\/\/[^)\s]+)\)$/.exec(src);
      if (other) {
        const img = document.createElement("img");
        img.src = other[2];
        img.alt = `:${other[1]}:`;
        img.dataset.emojiName = other[1];
        img.dataset.emojiSrc = other[2];
        img.className = "inline-emoji";
        img.draggable = false;
        img.contentEditable = "false";
        el.appendChild(img);
      } else if (src.startsWith(":") && src.endsWith(":")) {
        const name = src.slice(1, -1);
        const custom = getCustomEmojis().find((e) => e.name === name);
        if (custom?.url) {
          const img = document.createElement("img");
          img.src = custom.url;
          img.alt = src;
          img.dataset.emojiName = name;
          img.className = "inline-emoji";
          img.draggable = false;
          img.contentEditable = "false";
          el.appendChild(img);
          recordRecentEmoji(name, true, serverHost);
        }
      } else {
        el.appendChild(document.createTextNode(src));
      }

      const trailing = document.createTextNode(" ");
      el.appendChild(trailing);

      if (sel) {
        sel.removeAllRanges();
        const range = document.createRange();
        range.setStartAfter(trailing);
        range.collapse(true);
        sel.addRange(range);
      }

      autoResize(el);
      setEmojiPickerOpen(false);
    }, [serverHost]);

    const setContent = useCallback((text: string) => {
      const el = editorRef.current;
      if (!el) return;
      el.textContent = "";
      const channelName = (id: string) =>
        channelListRef.current?.find((c) => c.channelId === id)?.nickname ?? null;
      for (const segment of parseEditSegments(text, channelName)) {
        if ("text" in segment) {
          if (segment.text) el.appendChild(document.createTextNode(segment.text));
          continue;
        }
        const pill = document.createElement("span");
        pill.className = "chat-editor-mention";
        for (const [key, value] of Object.entries(segment.pill.dataset)) pill.dataset[key] = value;
        pill.textContent = segment.pill.text;
        pill.contentEditable = "false";
        pill.draggable = false;
        el.appendChild(pill);
      }
      autoResize(el);
      setLength(text.trim().length);
      onChangeRef.current?.();
      requestAnimationFrame(() => {
        el.focus();
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(el);
          sel.collapseToEnd();
        }
      });
    }, []);

    useImperativeHandle(ref, () => ({
      clear: () => {
        if (editorRef.current) {
          editorRef.current.textContent = "";
          autoResize(editorRef.current);
        }
        pendingFiles.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
        setPendingFiles([]);
      },
      focus: () => editorRef.current?.focus(),
      getMarkdown: () => editorRef.current ? serializeContentEditable(editorRef.current) : "",
      getFiles: () => pendingFiles.map((p) => p.file),
      addFiles,
      setContent,
      restore: ({ text, files }) => {
        const el = editorRef.current;
        if (!el) return;
        // Whatever was typed since the send stays, and the files join it.
        if (text && !serializeContentEditable(el).trim()) setContent(text);
        else el.focus();
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
        const el = editorRef.current;
        if (!el || !id) return;

        el.focus();

        const mention = document.createElement("span");
        mention.className = "chat-editor-mention";
        mention.dataset.mentionId = id;
        mention.dataset.mentionName = `@${name}`;
        mention.textContent = `@${name}`;
        mention.contentEditable = "false";
        mention.draggable = false;

        const trailing = document.createTextNode(" ");
        el.appendChild(mention);
        el.appendChild(trailing);

        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          const range = document.createRange();
          range.setStartAfter(trailing);
          range.collapse(true);
          sel.addRange(range);
        }
        autoResize(el);
      };
      window.addEventListener("mention_user", onMentionUser);
      return () => window.removeEventListener("mention_user", onMentionUser);
    }, []);

    useEffect(() => {
      return () => {
        pendingFilesRef.current.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
      };
    }, []);

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
          onClose={handleAutocompleteClose}
          serverHost={serverHost}
        />
        <MentionAutocomplete
          query={mentionQuery || ""}
          visible={showMentionAutocomplete}
          members={memberList || []}
          onSelect={handleMentionSelect}
          onClose={handleMentionAutocompleteClose}
        />
        <MentionAutocomplete
          query={channelQuery || ""}
          visible={channelQuery !== null}
          members={channelList || []}
          onSelect={handleChannelSelect}
          onClose={() => setChannelQuery(null)}
          title="Channels"
        />
        <div className="chat-editor-format-anchor" style={lastBarAt.current}>
          <AnimatePresence>
            {selectionBar && !disabled && (
              <motion.div
                key="bar"
                className="chat-editor-format-bar"
                role="toolbar"
                aria-label="Format the selection"
                initial={{ opacity: 0, y: 6, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.94 }}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }}
              >
                <AnimatePresence>
                  {selectionBar.link && (
                    <motion.div
                      key="link"
                      className="chat-editor-format-bar chat-editor-format-sub"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }}
                    >
                      <input
                        className="chat-editor-link-input"
                        type="url"
                        aria-label="Link address"
                        placeholder="Paste or type a link"
                        value={selectionBar.link.url}
                        onFocus={() => { editingLinkRef.current = true; }}
                        onBlur={() => { editingLinkRef.current = false; }}
                        onChange={(e) => {
                          const el = editorRef.current;
                          const link = selectionBar.link;
                          if (!el || !link) return;
                          const url = e.target.value;
                          const urlEnd = setComposerLinkUrl(el, link.urlStart, link.urlEnd, url);
                          setSelectionBar((bar) => bar && { ...bar, link: { ...link, urlEnd, url } });
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter" && e.key !== "Escape") return;
                          e.preventDefault();
                          editingLinkRef.current = false;
                          if (editorRef.current && selectionBar.link) selectComposerLinkText(editorRef.current, selectionBar.link.urlStart);
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
                        aria-pressed={selectionBar.active.has(format)}
                        title={label}
                        // Keeps the selection in the box: a click would move focus and drop it.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { if (editorRef.current) applyComposerFormat(editorRef.current, format); }}
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
          <div
            ref={editorRef}
            className="chat-editor-textarea"
            contentEditable={!disabled}
            role="textbox"
            aria-placeholder={placeholder || "Type a message..."}
            data-placeholder={placeholder || "Type a message..."}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDrop={handleDrop}
            onInput={handleInput}
            onClick={updateAutocompleteQueries}
            onFocus={(e) => autoResize(e.currentTarget, true)}
            onBlur={(e) => {
              // Into the link field is still writing this message.
              if (!wrapperRef.current?.contains(e.relatedTarget as Node | null)) autoResize(e.currentTarget, false);
            }}
          />
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
      </div>
      </div>
    );
  }
);

ChatEditor.displayName = "ChatEditor";
