import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import toast from "react-hot-toast";
import { File as FaFile, FileText as FaFileAlt, FileArchive as FaFileArchive, FileAudio as FaFileAudio, FileCode as FaFileCode, FileImage as FaFileImage, FileVideo as FaFileVideo, Paperclip as IoMdAttach } from "lucide-react";
const FaFilePdf = FaFileAlt;

import type { EmojiEntry } from "../utils/emojiData";
import { EmojiAutocomplete } from "./EmojiAutocomplete";

export interface ChatEditorHandle {
  clear: () => void;
  focus: () => void;
  getMarkdown: () => string;
  getFiles: () => File[];
  addFiles: (files: FileList | File[]) => void;
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
}

function getFileIcon(mime: string) {
  if (mime.startsWith("image/")) return <FaFileImage />;
  if (mime.startsWith("audio/")) return <FaFileAudio />;
  if (mime.startsWith("video/")) return <FaFileVideo />;
  if (mime === "application/pdf") return <FaFilePdf />;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar") || mime.includes("gzip") || mime.includes("compress")) return <FaFileArchive />;
  if (mime.includes("javascript") || mime.includes("json") || mime.includes("xml") || mime.includes("html") || mime.includes("css") || mime.includes("typescript")) return <FaFileCode />;
  if (mime.startsWith("text/")) return <FaFileAlt />;
  return <FaFile />;
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

  const match = before.match(/:([a-zA-Z0-9_+-]{2,})$/);
  if (!match) return null;

  const afterCursor = text.slice(offset);
  if (afterCursor.length > 0 && /^[a-zA-Z0-9_+-]/.test(afterCursor)) return null;

  return match[1];
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

  const match = before.match(/:([a-zA-Z0-9_+-]{2,})$/);
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
  ({ placeholder, disabled, maxFileSize, onSend }, ref) => {
    const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
    const pendingFilesRef = useRef<PendingFile[]>([]);
    pendingFilesRef.current = pendingFiles;

    const editorRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const onSendRef = useRef(onSend);
    onSendRef.current = onSend;

    const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
    const [showAutocomplete, setShowAutocomplete] = useState(false);

    const updateEmojiQuery = useCallback(() => {
      const q = getEmojiQueryAtCursor();
      setEmojiQuery(q);
      setShowAutocomplete(q !== null);
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
        if (showAutocomplete) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      },
      [handleSend, showAutocomplete]
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
      updateEmojiQuery();
    }, [updateEmojiQuery]);

    const handleEmojiSelect = useCallback((entry: EmojiEntry) => {
      replaceEmojiQueryAtCursor(entry);
      setShowAutocomplete(false);
      setEmojiQuery(null);
      if (editorRef.current) autoResize(editorRef.current);
    }, []);

    const handleAutocompleteClose = useCallback(() => {
      setShowAutocomplete(false);
      setEmojiQuery(null);
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
        />
        <div className="chat-editor-input-row">
          <button
            className="chat-editor-attach-btn"
            type="button"
            aria-label="Attach file"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
          >
            <IoMdAttach size={20} />
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
            onClick={updateEmojiQuery}
          />
        </div>
      </div>
    );
  }
);

ChatEditor.displayName = "ChatEditor";
