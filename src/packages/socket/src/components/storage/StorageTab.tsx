import { Avatar, Button, Checkbox, IconButton, Menu, Meter, Select, Spinner, TextField } from "@gryt/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import { PiCaretLeftBold, PiDotsThreeBold } from "../../../../../lib/icons";
import { formatFileSize } from "../../utils/formatFileSize";
import { ConfirmDialog } from "../ConfirmDialog";
import { ImageLightbox, type LightboxGallery } from "../ImageLightbox";
import { FreeUpSpaceDialog } from "./FreeUpSpaceDialog";
import { ask, type FilesPage, type StorageFile, type StorageFilter, type StorageOverview } from "./storageApi";
import { clearSelection, selectionFor, setFiles, toggleFile, useSelectionVersion } from "./storageSelection";

const KIND_LABELS: Record<string, string> = { uploads: "Files in messages", avatars: "Avatars", banners: "Banners", emojis: "Emoji" };
const PAGE = 50;
type Sort = "size" | "date" | "name" | "uploader";

function Label({ children }: { children: string }) {
  return <div className="text-[11px] font-semibold tracking-[0.08em] text-gryt-muted uppercase">{children}</div>;
}

function Uploader({ host, f }: { host: string; f: StorageFile }) {
  const name = f.uploader_nickname ?? "Someone";
  const src = resolveAvatarSrc(f.uploader_avatar_file_id ? getUploadsFileUrl(host, f.uploader_avatar_file_id, { thumb: true }) : undefined, name);
  return (
    <span className="flex items-center gap-2 min-w-0">
      <Avatar size="small" className="h-[22px] w-[22px] text-[10px] shrink-0" fallback={name[0]} src={src} />
      <span className="truncate text-[13px]">{name}</span>
    </span>
  );
}

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const meterTone = (pct: number) => {
  if (pct >= 90) return "danger" as const;
  return pct >= 75 ? "warning" as const : "primary" as const;
};
const isMedia = (f: StorageFile) => !!f.mime && (f.mime.startsWith("image/") || f.mime.startsWith("video/"));

export function StorageTab({ host, socket, onClose }: { host: string; socket: Socket | undefined; onClose: () => void }) {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [files, setFilesView] = useState<{ conversationId?: string; label?: string } | null>(null);
  const [freeOpen, setFreeOpen] = useState(false);

  const load = useCallback(() => {
    if (!socket) return;
    ask<StorageOverview>(socket, "storage:overview", {}).then(setOverview).catch((e: Error) => toast.error(e.message));
  }, [socket]);
  useEffect(load, [load]);

  if (!socket) return null;
  if (files) {
    return <FilesView host={host} socket={socket} scope={files} onBack={() => { setFilesView(null); load(); }} onClose={onClose} />;
  }
  if (!overview) return <div className="flex justify-center py-10"><Spinner size={18} /></div>;

  const pct = overview.limit ? Math.min(100, (overview.used / overview.limit) * 100) : 0;
  const kinds = Object.entries(overview.byKind).filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-col max-w-[720px]">
      <section aria-label="Space used" className="flex flex-col gap-4 pb-6">
        <Label>Space used</Label>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-baseline gap-2">
            <span className="text-[26px] font-bold">{formatFileSize(overview.used)}</span>
            {overview.limit && <span className="text-sm text-gryt-muted">of {formatFileSize(overview.limit)}</span>}
          </div>
          <Button size="small" onClick={() => setFreeOpen(true)}>Free up space</Button>
        </div>
        {overview.limit && <Meter value={pct} aria-label="Space used" tone={meterTone(pct)} />}
        <div className="flex flex-col gap-3 pt-1">
          {kinds.map(([kind, bytes]) => (
            <div key={kind} className="grid items-center gap-3.5" style={{ gridTemplateColumns: "170px minmax(0, 1fr) 72px" }}>
              <span className="text-[13px] text-gryt-muted">{KIND_LABELS[kind] ?? "Other"}</span>
              <Meter value={overview.used ? (bytes / overview.used) * 100 : 0} aria-label={KIND_LABELS[kind] ?? "Other"} />
              <span className="font-mono text-xs text-gryt-muted text-right">{formatFileSize(bytes)}</span>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="Biggest channels" className="flex flex-col gap-1 border-t border-gryt-neutral-4 py-5">
        <div className="pb-2"><Label>Biggest channels</Label></div>
        {overview.channels.length === 0 && <span className="text-sm text-gryt-muted">No files posted yet.</span>}
        {overview.channels.map((c) => (
          <div key={c.conversation_id} className="flex items-center gap-3 min-h-10">
            <span className="flex-1 text-sm truncate">{c.channel_name ? `#${c.channel_name}` : "Direct messages"}</span>
            <span className="text-xs text-gryt-muted">{c.files} files</span>
            <span className="font-mono text-xs w-[72px] text-right">{formatFileSize(c.bytes)}</span>
            <Button size="xsmall" tone="neutral" onClick={() => setFilesView({ conversationId: c.conversation_id, label: c.channel_name ? `#${c.channel_name}` : "Direct messages" })}>Review</Button>
          </div>
        ))}
      </section>

      <section aria-label="Biggest files" className="flex flex-col gap-1 border-t border-gryt-neutral-4 pt-5">
        <div className="flex items-center justify-between pb-2">
          <Label>Biggest files</Label>
          <button type="button" className="gryt-link text-[13px]" onClick={() => setFilesView({})}>See all files</button>
        </div>
        {overview.files.map((f) => (
          <div key={f.file_id} className="flex items-center gap-3 min-h-10">
            <span className="flex-1 min-w-0 text-sm truncate">{f.original_name ?? "File"}</span>
            <span className="w-40 min-w-0"><Uploader host={host} f={f} /></span>
            <span className="font-mono text-xs w-[72px] text-right">{formatFileSize(f.size)}</span>
          </div>
        ))}
      </section>

      <FreeUpSpaceDialog open={freeOpen} onOpenChange={setFreeOpen} socket={socket} overview={overview} onDone={load} />
    </div>
  );
}

function FilesView({ host, socket, scope, onBack, onClose }: {
  host: string;
  socket: Socket;
  scope: { conversationId?: string; label?: string };
  onBack: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<StorageFilter["kind"] | "all">("all");
  const [sort, setSort] = useState<Sort>("size");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState<FilesPage | null>(null);
  const [preview, setPreview] = useState<LightboxGallery | null>(null);
  const [confirm, setConfirm] = useState<StorageFile[] | null>(null);
  useSelectionVersion();
  const picked = selectionFor(host);

  const fetchPage = useCallback((offset: number) => {
    const filter = { conversationId: scope.conversationId, kind: kind === "all" ? undefined : kind, q: q || undefined };
    ask<FilesPage>(socket, "storage:files", { ...filter, sort, dir, offset, limit: PAGE })
      .then((next) => setPage((prev) => (offset > 0 && prev ? { ...next, items: [...prev.items, ...next.items] } : next)))
      .catch((e: Error) => toast.error(e.message));
  }, [socket, scope.conversationId, kind, q, sort, dir]);

  useEffect(() => {
    const t = setTimeout(() => fetchPage(0), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [fetchPage, q]);

  const sortBy = (s: Sort) => {
    if (s === sort) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(s); setDir(s === "name" || s === "uploader" ? "asc" : "desc"); }
  };

  const items = useMemo(() => page?.items ?? [], [page]);
  const media = items.filter(isMedia);
  const openPreview = (f: StorageFile) => setPreview({
    items: media.map((m) => ({ kind: m.mime?.startsWith("video/") ? "video" : "image", name: m.original_name ?? "File", fileId: m.file_id, serverHost: host })),
    index: Math.max(0, media.findIndex((m) => m.file_id === f.file_id)),
    title: { name: f.uploader_nickname ?? "Someone", detail: date(f.created_at) },
  });
  const goTo = (f: StorageFile) => {
    window.dispatchEvent(new CustomEvent("open_message", { detail: { host, conversationId: f.conversation_id, messageId: f.message_id } }));
    onClose();
  };
  const remove = async (list: StorageFile[] | string[]) => {
    const ids = list.map((f) => (typeof f === "string" ? f : f.file_id));
    let deleted = 0;
    let bytes = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const r = await ask<{ deleted: number; bytes: number }>(socket, "storage:delete", { fileIds: ids.slice(i, i + 500) }, "storage:deleted", 60_000);
      deleted += r.deleted;
      bytes += r.bytes;
    }
    setFiles(host, ids.map((file_id) => ({ file_id, size: 0 })), false);
    toast.success(`Deleted ${deleted} ${deleted === 1 ? "file" : "files"}, ${formatFileSize(bytes)} freed`);
    fetchPage(0);
  };

  const selectedBytes = [...picked.values()].reduce((s, n) => s + n, 0);
  const ascending = dir === "asc";
  const ariaSort = (s: Sort) => {
    if (sort !== s) return "none" as const;
    return ascending ? "ascending" as const : "descending" as const;
  };
  const head = (s: Sort, label: string, right = false) => (
    <span role="columnheader" aria-sort={ariaSort(s)} className={right ? "text-right" : undefined}>
      <button type="button" onClick={() => sortBy(s)}
        className={`whitespace-nowrap text-[11px] font-semibold tracking-[0.08em] uppercase px-1.5 py-1 rounded-lg ${sort === s ? "text-gryt-text" : "text-gryt-muted"}`}>
        {label} {sort === s && (ascending ? "▲" : "▼")}
      </button>
    </span>
  );
  const cols = "36px minmax(0, 1fr) 160px 110px 84px 36px";

  return (
    <div className="flex flex-col gap-3 relative min-h-full">
      <div className="flex items-center gap-2.5">
        <IconButton size="xsmall" tone="neutral" aria-label="Back to Storage" onClick={onBack}><PiCaretLeftBold size={12} /></IconButton>
        <span className="text-[15px] font-semibold">Files</span>
        {page && <span className="text-[13px] text-gryt-muted">{scope.label ? `${scope.label} · ` : ""}{page.total} files · {formatFileSize(page.totalBytes)}</span>}
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <TextField className="flex-1 min-w-[220px]" size="small" placeholder="Search files" aria-label="Search files" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select size="small" className="w-36" value={kind} onValueChange={(v) => setKind(v as typeof kind)}
          options={[{ label: "All types", value: "all" }, { label: "Videos", value: "video" }, { label: "Images", value: "image" }, { label: "Other files", value: "other" }]} />
      </div>

      <div role="table" aria-label="Files" className="flex flex-col pb-20">
        <div role="row" className="grid items-center gap-2 px-2 py-1.5 border-b border-gryt-neutral-4" style={{ gridTemplateColumns: cols }}>
          <span role="columnheader"><span className="sr-only">Selected</span></span>
          {head("name", "Name")}
          {head("uploader", "Posted by")}
          {head("date", "Date")}
          {head("size", "Size", true)}
          <span role="columnheader" />
        </div>
        {!page && <div className="flex justify-center py-8"><Spinner size={16} /></div>}
        {page && items.length === 0 && <div className="text-sm text-gryt-muted py-8 text-center">No files match.</div>}
        {items.map((f) => (
          <div role="row" key={f.file_id} className="grid items-center gap-2 px-2 min-h-12 rounded-xl"
            style={{ gridTemplateColumns: cols, background: picked.has(f.file_id) ? "var(--gryt-accent-2)" : undefined }}>
            <span role="cell"><Checkbox checked={picked.has(f.file_id)} onCheckedChange={() => toggleFile(host, f.file_id, f.size)} aria-label={`Select ${f.original_name ?? "file"}`} /></span>
            <span role="cell" className="flex flex-col min-w-0">
              {isMedia(f)
                ? <button type="button" className="text-sm text-left truncate" onClick={() => openPreview(f)}>{f.original_name ?? "File"}</button>
                : <span className="text-sm truncate">{f.original_name ?? "File"}</span>}
              {(f.thread_title || (!scope.conversationId && f.channel_name)) && (
                <span className="text-xs text-gryt-muted truncate">{f.thread_title ? `Thread: ${f.thread_title}` : `#${f.channel_name}`}</span>
              )}
            </span>
            <span role="cell" className="min-w-0"><Uploader host={host} f={f} /></span>
            <span role="cell" className="text-[13px] text-gryt-muted">{date(f.created_at)}</span>
            <span role="cell" className="font-mono text-xs text-right">{formatFileSize(f.size)}</span>
            <span role="cell">
              <Menu.Root>
                <Menu.Trigger render={<IconButton size="xsmall" tone="ghost" aria-label={`More for ${f.original_name ?? "file"}`} />}><PiDotsThreeBold size={14} /></Menu.Trigger>
                <Menu.Portal>
                  <Menu.Positioner>
                    <Menu.Popup>
                      {isMedia(f) && <Menu.Item onClick={() => openPreview(f)}>Preview</Menu.Item>}
                      <Menu.Item onClick={() => goTo(f)}>Go to message</Menu.Item>
                      <Menu.Separator />
                      <Menu.Item onClick={() => setConfirm([f])}>Delete</Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.Root>
            </span>
          </div>
        ))}
        {page && items.length < page.total && (
          <div className="flex justify-center pt-3"><Button size="small" tone="neutral" onClick={() => fetchPage(items.length)}>Show more</Button></div>
        )}
      </div>

      {picked.size > 0 && (
        <div className="sticky bottom-3 flex items-center gap-2 rounded-full border border-gryt-neutral-5 bg-gryt-neutral-4 py-2 pr-2 pl-5">
          <span className="flex-1 text-[13px]">{picked.size} selected · {formatFileSize(selectedBytes)}</span>
          <Button size="small" tone="ghost" onClick={() => clearSelection(host)}>Deselect all</Button>
          <Button size="small" tone="ghost" onClick={() => setFiles(host, items, true)}>Select all shown</Button>
          <Button size="small" tone="danger" onClick={() => setConfirm([])}>Delete {picked.size} {picked.size === 1 ? "file" : "files"}</Button>
        </div>
      )}

      {preview && <ImageLightbox gallery={preview} onClose={() => setPreview(null)} />}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={confirm?.length === 1 ? `Delete ${confirm[0].original_name ?? "this file"}?` : `Delete ${picked.size} files?`}
        description={confirm?.length === 1
          ? `${formatFileSize(confirm[0].size)}, posted by ${confirm[0].uploader_nickname ?? "someone"}. It's gone for everyone, and the message shows it as deleted.`
          : `${formatFileSize(selectedBytes)}. They're gone for everyone, and their messages show them as deleted.`}
        confirmLabel="Delete"
        onConfirm={() => {
          const list = confirm?.length ? confirm : [...picked.keys()];
          setConfirm(null);
          remove(list).catch((e: Error) => toast.error(e.message));
        }}
      />
    </div>
  );
}
