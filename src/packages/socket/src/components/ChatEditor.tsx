import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { MdAttachFile, MdAudioFile, MdCode, MdDescription, MdFolderZip, MdImage, MdInsertDriveFile, MdInsertEmoticon, MdSend, MdVideoFile } from "react-icons/md";
const FaFilePdf = MdDescription;

import { type EmojiEntry, getCustomEmojis, recordRecentEmoji } from "../utils/emojiData";
import { EmojiAutocomplete } from "./EmojiAutocomplete";
import { EmojiPicker } from "./EmojiPicker";
import { MentionAutocomplete, type MentionMember } from "./MentionAutocomplete";

export interface ChatEditorHandle {
  clear: () => void;
  focus: () => void;
  getMarkdown: () => string;
  getFiles: () => File[];
  addFiles: (files: FileList | File[]) => void;
  setContent: (text: string) => void;
}

interface PendingFile {
  id: string;
  file: File;
  previewUrl: string | null;
}

interface ChatEditorProps {
  placeholder?: string;
  disabled?: boolean;
  maxFileSize?: number | null;
  onSend: (markdown: string, files: File[]) => void;
  onArrowUpEmpty?: () => void;
  onCancel?: () => void;
  isEditing?: boolean;
  memberList?: MentionMember[];
  serverHost?: string;
}

function getFileIcon(mime: string) {
  if (mime.startsWith("image/")) return <MdImage size={14} />;
  if (mime.startsWith("audio/")) return <MdAudioFile size={14} />;
  if (mime.startsWith("video/")) return <MdVideoFile size={14} />;
  if (mime === "application/pdf") return <FaFilePdf size={14} />;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar") || mime.includes("gzip") || mime.includes("compress")) return <MdFolderZip size={14} />;
  if (mime.includes("javascript") || mime.includes("json") || mime.includes("xml") || mime.includes("html") || mime.includes("css") || mime.includes("typescript")) return <MdCode size={14} />;
  if (mime.startsWith("text/")) return <MdDescription size={14} />;
  return <MdInsertDriveFile size={14} />;
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
        result += `:${elem.dataset.emojiName}:`;
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

function autoResize(el: HTMLElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}

function getEmojiQueryAtCursor(): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent || "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);

  const match = before.match(/:([a-zA-Z0-9_+-]*)$/);
  if (!match) return null;

  const afterCursor = text.slice(offset);
  if (afterCursor.length > 0 && /^[a-zA-Z0-9_+-]/.test(afterCursor)) return null;

  const query = match[1];
  if (query.length === 1) return null;

  return query;
}

function getMentionQueryAtCursor(): string | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.textContent || "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);

  const match = before.match(/(^|[\s])@([a-zA-Z0-9_ ]*)$/);
  if (!match) return null;

  const afterCursor = text.slice(offset);
  if (afterCursor.length > 0 && /^[a-zA-Z0-9_]/.test(afterCursor)) return null;

  return match[2];
}

function replaceMentionQueryAtCursor(member: MentionMember): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;

  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;

  const text = node.textContent || "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);

  const match = before.match(/(^|[\s])@([a-zA-Z0-9_ ]*)$/);
  if (!match) return;

  const atStart = offset - match[0].length + match[1].length;

  const replaceRange = document.createRange();
  replaceRange.setStart(node, atStart);
  replaceRange.setEnd(node, offset);
  replaceRange.deleteContents();

  const mention = document.createElement("span");
  mention.className = "chat-editor-mention";
  mention.dataset.mentionId = member.serverUserId;
  mention.dataset.mentionName = `@${member.nickname}`;
  mention.textContent = `@${member.nickname}`;
  mention.contentEditable = "false";
  mention.draggable = false;

  const trailing = document.createTextNode(" ");
  replaceRange.insertNode(trailing);
  replaceRange.insertNode(mention);

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

  const text = node.textContent || "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);

  const match = before.match(/:([a-zA-Z0-9_+-]*)$/);
  if (!match) return;

  const colonStart = offset - match[0].length;

  const replaceRange = document.createRange();
  replaceRange.setStart(node, colonStart);
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
  ({ placeholder, disabled, maxFileSize, onSend, onArrowUpEmpty, onCancel, isEditing, memberList, serverHost }, ref) => {
    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
    const pendingFilesRef = useRef<PendingFile[]>([]);
    pendingFilesRef.current = pendingFiles;

    const editorRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const onSendRef = useRef(onSend);
    onSendRef.current = onSend;

    const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
    const [showAutocomplete, setShowAutocomplete] = useState(false);
    const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [showMentionAutocomplete, setShowMentionAutocomplete] = useState(false);

    const updateAutocompleteQueries = useCallback(() => {
      const mq = getMentionQueryAtCursor();
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

    const handleSend = useCallback(() => {
      const el = editorRef.current;
      if (!el) return;

      const text = serializeContentEditable(el).trim();
      const files = pendingFilesRef.current.map((p) => p.file);

      if (!text && files.length === 0) return;

      onSendRef.current(text, files);
      el.textContent = "";
      autoResize(el);
      pendingFilesRef.current.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
      setPendingFiles([]);
      setShowAutocomplete(false);
      setEmojiQuery(null);
      setShowMentionAutocomplete(false);
      setMentionQuery(null);
    }, []);

    const addFiles = useCallback((files: FileList | File[]) => {
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
    }, [maxFileSize]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (showAutocomplete || showMentionAutocomplete) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
          return;
        }
        if (e.key === "Escape" && isEditing && onCancel) {
          e.preventDefault();
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
      [handleSend, showAutocomplete, showMentionAutocomplete, isEditing, onCancel, onArrowUpEmpty]
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
        if (text) {
          document.execCommand("insertText", false, text);
        }
      },
      [addFiles]
    );

    const handleDrop = useCallback(
      (e: React.DragEvent<HTMLDivElement>) => {
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        addFiles(files);
      },
      [addFiles]
    );

    const handleInput = useCallback(() => {
      if (editorRef.current) autoResize(editorRef.current);
      updateAutocompleteQueries();
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

    const handleMentionSelect = useCallback((member: MentionMember) => {
      replaceMentionQueryAtCursor(member);
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

      if (src.startsWith(":") && src.endsWith(":")) {
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
      setContent: (text: string) => {
        const el = editorRef.current;
        if (!el) return;
        el.textContent = text;
        autoResize(el);
        requestAnimationFrame(() => {
          el.focus();
          const sel = window.getSelection();
          if (sel) {
            sel.selectAllChildren(el);
            sel.collapseToEnd();
          }
        });
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
      return () => {
        pendingFilesRef.current.forEach((p) => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
      };
    }, []);

    return (
      <div className={`chat-editor-wrapper ${disabled ? "chat-editor-disabled" : ""}`} style={{ position: "relative" }}>
        {pendingFiles.length > 0 && (
          <div className="chat-editor-file-preview-bar">
            {pendingFiles.map((pf) => (
              <div key={pf.id} className="chat-editor-file-preview">
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
                  ✕
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
        <div className="chat-editor-input-row">
          <button
            className="chat-editor-attach-btn"
            type="button"
            aria-label="Attach file"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            <MdAttachFile size={20} />
          </button>
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
          <div style={{ position: "relative" }}>
            <button
              className="chat-editor-emoji-btn"
              type="button"
              aria-label="Insert emoji"
              disabled={disabled}
              onClick={() => setEmojiPickerOpen((v) => !v)}
            >
              <MdInsertEmoticon size={20} />
            </button>
            {emojiPickerOpen && (
              <EmojiPicker
                onSelect={handlePickerEmojiSelect}
                onClose={() => setEmojiPickerOpen(false)}
                serverHost={serverHost}
              />
            )}
          </div>
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
          />
          <button
            className="chat-editor-send-btn"
            type="button"
            aria-label="Send message"
            disabled={disabled}
            onClick={handleSend}
          >
            <MdSend size={20} />
          </button>
        </div>
      </div>
    );
  }
);

ChatEditor.displayName = "ChatEditor";
