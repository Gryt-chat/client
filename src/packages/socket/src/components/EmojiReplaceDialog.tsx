import { ReactionPill } from "@gryt/ui";

import { ConfirmDialog } from "./ConfirmDialog";

export interface EmojiReplacement {
  name: string;
  beforeUrl: string;
  afterUrl: string;
}

/** The same message twice, old picture and new, in the text and as a reaction, before anything changes for everyone. */
export function EmojiReplaceDialog({
  replacement,
  busy,
  onConfirm,
  onCancel,
}: {
  replacement: EmojiReplacement | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = replacement?.name ?? "";
  return (
    <ConfirmDialog
      open={replacement !== null}
      title={`Replace :${name}:?`}
      description="Everyone on this server sees the new picture, in old messages and reactions too."
      confirmLabel={busy ? "Replacing…" : "Replace"}
      confirmTone="primary"
      confirmDisabled={busy}
      width="36rem"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {replacement && (
        <div className="flex gap-3">
          <Sample label="Before" name={name} url={replacement.beforeUrl} />
          <Sample label="After" name={name} url={replacement.afterUrl} />
        </div>
      )}
    </ConfirmDialog>
  );
}

function Sample({ label, name, url }: { label: string; name: string; url: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-(--gryt-radius-md) bg-gryt-neutral-3 p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-gryt-muted">{label}</span>
      {/* Drawn here rather than through MarkdownRenderer, which only takes this server's emoji links, not a local preview. */}
      <div className="markdown-message">
        Looks good{" "}
        <img
          src={url}
          alt={`:${name}:`}
          className="inline-emoji"
          style={{ height: "1.4em", width: "auto", verticalAlign: "middle", display: "inline", objectFit: "contain", margin: "0 1px" }}
        />
      </div>
      <div>
        <ReactionPill emoji={`:${name}:`} count={3} customEmojis={new Map([[name, url]])} />
      </div>
    </div>
  );
}
