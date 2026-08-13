import { Checkbox, Chip } from "@gryt/ui";
import { TextField } from "@radix-ui/themes";
import { type ChangeEvent } from "react";

import { type ImportEmoteWithMeta } from "../utils/emoteImportUtils";

interface EmoteRowProps {
  emote: ImportEmoteWithMeta;
  importing: boolean;
  onToggleSelect: (id: string) => void;
  onUpdateName: (id: string, name: string) => void;
}

export function EmoteRow({
  emote: e,
  importing,
  onToggleSelect,
  onUpdateName,
}: EmoteRowProps) {
  return (
    <div className="flex items-center gap-2 py-1 px-2" style={{
        border: "1px solid var(--gray-a4)",
        borderRadius: "var(--radius-1)",
        opacity: e.selected ? 1 : 0.5,
      }}>
      <Checkbox
        checked={e.selected}
        onCheckedChange={() => onToggleSelect(e.id)}
        disabled={importing}
      />
      <div className="emoji-upload-preview-wrap"
        data-status={
          e.status === "processing"
            ? "processing"
            : (e.status === "uploading" || e.status === "downloading")
              ? "uploading"
              : undefined
        }
      >
        <img
          className="emoji-upload-preview-img"
          src={e.previewUrl}
          alt={e.code}
        />
        {(e.status === "downloading" || e.status === "uploading" || e.status === "processing") && (
          <div className="emoji-upload-preview-overlay">
            <div className="emoji-upload-preview-label">
              {e.status === "downloading"
                ? `DL ${e.progress}%`
                : e.status === "processing"
                  ? "PROC"
                  : `${e.progress}%`}
            </div>
            {(e.status === "downloading" || e.status === "uploading" || e.status === "processing") && (
              <div className="emoji-upload-preview-bar">
                <div className="emoji-upload-preview-bar-inner"
                  style={{ width: `${e.status === "processing" ? 100 : e.progress}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
        <div className="flex items-center gap-1">
          <TextField.Root
            size="1"
            value={e.name}
            onChange={(ev: ChangeEvent<HTMLInputElement>) =>
              onUpdateName(e.id, ev.target.value)
            }
            placeholder="shortcode"
            disabled={importing || !e.selected}
            style={{ flex: 1 }}
          />
          {e.code !== e.name && (
            <span className="text-xs text-gryt-muted" style={{
                flexShrink: 0,
                maxWidth: 100,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
              {e.code}
            </span>
          )}
        </div>
        {e.selected && e.nameError && (
          <span className="text-xs text-gryt-danger" style={{ lineHeight: 1.2 }}>
            {e.nameError}
          </span>
        )}
        {e.selected && !e.nameError && e.nameWarning && (
          <span className="text-xs" color="yellow" style={{ lineHeight: 1.2 }}>
            {e.nameWarning}
          </span>
        )}
        {e.selected && e.status === "error" && e.lastError && (
          <span className="text-xs text-gryt-danger" style={{ lineHeight: 1.2 }}>
            {e.lastError}
          </span>
        )}
      </div>
      {e.animated && (
        <Chip tone="primary" label="GIF" />
      )}
    </div>
  );
}
