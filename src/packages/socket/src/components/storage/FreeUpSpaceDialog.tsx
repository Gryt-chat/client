import { Select } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { formatFileSize } from "../../utils/formatFileSize";
import { ConfirmDialog } from "../ConfirmDialog";
import { ask, type StorageOverview } from "./storageApi";

const AGES = [{ label: "Any age", value: "0" }, { label: "1 month", value: "30" }, { label: "6 months", value: "182" }, { label: "1 year", value: "365" }];
const SIZES = [{ label: "Any size", value: "0" }, { label: "10 MB", value: String(10 * 1024 ** 2) }, { label: "50 MB", value: String(50 * 1024 ** 2) }, { label: "200 MB", value: String(200 * 1024 ** 2) }];

/** Deletes everything a filter matches, after the server has counted it. */
export function FreeUpSpaceDialog({ open, onOpenChange, socket, overview, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  socket: Socket;
  overview: StorageOverview;
  onDone: () => void;
}) {
  const [age, setAge] = useState("182");
  const [size, setSize] = useState(String(50 * 1024 ** 2));
  const [where, setWhere] = useState("all");
  const [count, setCount] = useState<{ count: number; bytes: number } | null>(null);
  const filter = { olderThanDays: Number(age) || undefined, minBytes: Number(size) || undefined, conversationId: where === "all" ? undefined : where };

  useEffect(() => {
    if (!open) return;
    setCount(null);
    ask<{ count: number; bytes: number }>(socket, "storage:purge", { ...filter, dryRun: true }).then(setCount).catch((e: Error) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when a choice changes
  }, [open, age, size, where, socket]);

  const row = (label: string, control: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 min-h-12 border-b border-gryt-neutral-4">
      <span className="text-sm">{label}</span>
      {control}
    </div>
  );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Free up space"
      description="Delete files by age, size or channel. Their messages stay."
      confirmLabel={count ? `Delete ${count.count} ${count.count === 1 ? "file" : "files"}` : "Delete"}
      confirmDisabled={!count || count.count === 0}
      onConfirm={() => {
        onOpenChange(false);
        ask<{ count: number; bytes: number }>(socket, "storage:purge", { ...filter, dryRun: false }, "storage:purge", 120_000)
          .then((r) => { toast.success(`Deleted ${r.count} files, ${formatFileSize(r.bytes)} freed`); onDone(); })
          .catch((e: Error) => toast.error(e.message));
      }}
    >
      <div className="flex flex-col">
        {row("Older than", <Select size="small" className="w-40" value={age} onValueChange={(v) => setAge(String(v))} options={AGES} />)}
        {row("Bigger than", <Select size="small" className="w-40" value={size} onValueChange={(v) => setSize(String(v))} options={SIZES} />)}
        {row("In", (
          <Select size="small" className="w-40" value={where} onValueChange={(v) => setWhere(String(v))}
            options={[{ label: "All channels", value: "all" }, ...overview.channels.filter((c) => c.channel_name).map((c) => ({ label: `#${c.channel_name}`, value: c.conversation_id }))]} />
        ))}
      </div>
      <div className="mt-4 flex flex-col gap-2 rounded-xl bg-gryt-neutral-2 px-4 py-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">{count ? `${count.count} files` : "Counting…"}</span>
          {count && <span className="font-mono text-[13px]">{formatFileSize(count.bytes)}</span>}
        </div>
        {count && <span className="text-xs text-gryt-muted">{formatFileSize(overview.used)} used now, {formatFileSize(Math.max(0, overview.used - count.bytes))} after.</span>}
        <span className="text-xs text-gryt-muted">Deleted files are gone for everyone.</span>
      </div>
    </ConfirmDialog>
  );
}
