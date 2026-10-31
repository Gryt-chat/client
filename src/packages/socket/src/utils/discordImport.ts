import { type DiscordPackageDm, type DiscordPackageMessage, type ImportFileStore, type ImportLeftOut, type ImportProgress, isDiscordPackage, linksExpireAt, listDiscordDms, readDiscordDm, retryAfterMs, retryLeftOut,runDiscordImport } from "@gryt/core";
import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";

import { openLocalArchive, sealAttachment } from "@/common";

import { uploadChatFile } from "../hooks/uploadChatFile";
import type { MlsSource } from "../mls/serverMls";
import { getMediaDimensions } from "./imageUtils";
import { openZip, type ZipFiles } from "./zipReader";

export type DiscordDm = DiscordPackageDm;

export interface DiscordImportPlan {
  dm: DiscordDm;
  messages: DiscordPackageMessage[];
  /** When Discord's file links stop working, from the `ex` in them. Null when they carry none. */
  linksUntil: number | null;
}

export interface Count {
  done: number;
  total: number;
}

export type DiscordImportState =
  | {
      kind: "running";
      paused: boolean;
      messages: Count;
      downloaded: Count;
      sent: Count;
      bytesPerSecond: number;
      finishesAt: number | null;
      limited: boolean;
      linksUntil: number | null;
      peerAdded: boolean;
    }
  | { kind: "asked"; by: string }
  | { kind: "missing"; files: number; imported: number; linksUntil: number | null; leftOut: ImportLeftOut[] }
  | { kind: "stopped"; name: string; done: number; total: number }
  | { kind: "done"; mine: number; theirs: number | null; files: number; tooLarge: number; firstAt: number; lastAt: number; leftOut: ImportLeftOut[] };

export const fmtCount = (n: number) => n.toLocaleString("en-US");

export function fmtWhen(at: number): string {
  return new Date(at).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export const fmtTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function fmtDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Reads a dropped file as a Discord package and lists its DMs. Throws a sentence for anything else. */
export async function readPackage(file: File): Promise<{ files: ZipFiles; dms: DiscordDm[] }> {
  const files = await openZip(file);
  if (!isDiscordPackage(files.names)) throw new Error("That zip isn’t a Discord data package. It should have a Messages folder in it.");
  const dms = await listDiscordDms(files);
  if (!dms.length) throw new Error("There are no DMs with messages in that package. Was Messages ticked when you asked for it?");
  return { files, dms };
}

export async function planImport(files: ZipFiles, dm: DiscordDm): Promise<DiscordImportPlan> {
  const messages = await readDiscordDm(files, dm.channelId);
  return { dm, messages, linksUntil: linksExpireAt(messages.flatMap((m) => m.attachments)) };
}

function running(p: ImportProgress, plan: DiscordImportPlan, paused: boolean, peerAdded: boolean, limited = false): Extract<DiscordImportState, { kind: "running" }> {
  const seconds = Math.max(1, (Date.now() - p.startedAt) / 1000);
  const bytesPerSecond = p.bytes / seconds;
  const perSent = p.sent.done ? (Date.now() - p.startedAt) / p.sent.done : null;
  return {
    kind: "running",
    paused,
    messages: p.messages,
    downloaded: p.downloaded,
    sent: p.sent,
    bytesPerSecond,
    finishesAt: perSent === null ? null : Date.now() + perSent * (p.sent.total - p.sent.done),
    limited,
    linksUntil: plan.linksUntil,
    peerAdded,
  };
}

/** Downloads wait in Cache Storage, which is on disk and survives a restart. */
function cacheStore(cache: Cache): ImportFileStore {
  return {
    has: async (url) => !!(await cache.match(url)),
    put: async (url, { type, bytes }) => cache.put(url, new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { "content-type": type } })),
    take: async (url) => {
      const hit = await cache.match(url);
      return hit ? { type: hit.headers.get("content-type") ?? "", bytes: new Uint8Array(await hit.arrayBuffer()) } : null;
    },
    drop: async (url) => void (await cache.delete(url)),
  };
}

type Saved = Omit<Extract<DiscordImportState, { kind: "stopped" }>, "kind">;
const savedKey = (conversationId: string) => `gryt.discordImport.${conversationId}`;

/** How far an import got, so a restart can say so. The package itself can't be kept. */
function readSaved(conversationId: string): Saved | null {
  try {
    const raw = localStorage.getItem(savedKey(conversationId));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function writeSaved(conversationId: string, saved: Saved | null): void {
  try {
    if (saved) localStorage.setItem(savedKey(conversationId), JSON.stringify(saved));
    else localStorage.removeItem(savedKey(conversationId));
  } catch {
    // Private mode or full storage: the import still runs, a restart just won't mention it.
  }
}

/** One DM's import (GRYT-1965). Re-running is safe: ids come from Discord's, and downloads stay cached. */
export function useDiscordImport({ host, conversationId, peer, source, maxFileBytes }: { maxFileBytes?: number | null; host: string | undefined; conversationId: string | undefined; peer: string | undefined; source: MlsSource | null }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, setState] = useState<DiscordImportState | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const paused = useRef(false);
  const stopped = useRef(false);
  const lastPlan = useRef<DiscordImportPlan | null>(null);
  const carried = useRef<ImportLeftOut[]>([]);
  const retrying = useRef(false);

  const start = useCallback(async (plan: DiscordImportPlan) => {
    if (!host || !conversationId || !peer || !source) return;
    if (!retrying.current) {
      lastPlan.current = plan;
      carried.current = [];
    }
    paused.current = false;
    stopped.current = false;
    setOwner(conversationId);
    const cache = await caches.open("gryt-discord-import");
    const { messages } = await openLocalArchive();
    let limitedUntil = 0;
    const report = (p: ImportProgress) => {
      setState(running(p, plan, paused.current, false, Date.now() < limitedUntil));
      writeSaved(conversationId, { name: plan.dm.name, done: p.messages.done, total: p.messages.total });
    };
    const done = await runDiscordImport(plan.messages, {
      send: async (content) => { await source.send(conversationId, peer, content); },
      upload: async ({ name, type, bytes }) => {
        const file = new File([bytes as Uint8Array<ArrayBuffer>], name, { type });
        const up = await uploadChatFile(file, host, await getMediaDimensions(file), (b, about) => sealAttachment({ bytes: b, conversationId, ...about })).catch((e: { status?: number; retryAfter?: string | null }) => {
          if (e.status === 429) {
            const wait = retryAfterMs(e.retryAfter ?? null);
            limitedUntil = Date.now() + wait;
            setState((s) => (s?.kind === "running" ? { ...s, limited: true } : s));
            return { retryAfterMs: wait };
          }
          if (e.status === 413) return { tooLarge: true as const };
          throw e;
        });
        if ("retryAfterMs" in up || "tooLarge" in up) return up;
        if (!up.meta) throw new Error("The file was uploaded without its key.");
        return { id: up.fileId, key: up.meta };
      },
      download: async (url) => {
        const desktop = window.electronAPI?.discordFileFetch;
        if (desktop) {
          const got = await desktop(url);
          if (got.status === 429) return { retryAfterMs: retryAfterMs(got.retryAfter) };
          return got.bytes ? { type: got.type, bytes: got.bytes } : null;
        }
        const res = await fetch(url);
        if (res.status === 429) return { retryAfterMs: retryAfterMs(res.headers.get("retry-after")) };
        return res.ok ? { type: res.headers.get("content-type") ?? "", bytes: new Uint8Array(await res.arrayBuffer()) } : null;
      },
      store: cacheStore(cache),
      bundles: true,
      // The limit may have just been raised, and this copy of it can be old: the server decides.
      maxFileBytes: retrying.current ? null : maxFileBytes,
      alreadyHas: async (id) => !!(await messages.get(source.storeScope, conversationId, id)),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      newId: () => crypto.randomUUID(),
    }, { paused: () => paused.current, stopped: () => stopped.current }, report).catch((e: Error) => {
      toast.error(e instanceof Error ? `The import stopped: ${e.message}` : "The import stopped.");
      return null;
    });
    if (stopped.current) return;
    if (!done) {
      const saved = readSaved(conversationId);
      setState(saved ? { kind: "stopped", ...saved } : null);
      return;
    }
    writeSaved(conversationId, null);
    setState(done.missing
      ? { kind: "missing", files: done.downloaded.total, imported: done.downloaded.total - done.missing, linksUntil: plan.linksUntil, leftOut: [...carried.current, ...done.leftOut] }
      : { kind: "done", mine: plan.messages.length, theirs: null, files: done.sent.total - done.tooLarge, tooLarge: done.tooLarge, leftOut: [...carried.current, ...done.leftOut], firstAt: plan.dm.firstAt, lastAt: plan.dm.lastAt });
  }, [host, conversationId, peer, source, maxFileBytes]);

  /* The package isn't kept past a restart, so this is null then and the card asks for it again. */
  const retry = useCallback((urls: string[]) => {
    const plan = lastPlan.current;
    if (!plan) return;
    const chosen = new Set(urls);
    setState((s) => {
      if (s?.kind === "done" || s?.kind === "missing") carried.current = s.leftOut.filter((f) => !chosen.has(f.url));
      return s;
    });
    retrying.current = true;
    void start({ ...plan, messages: retryLeftOut(plan.messages, chosen) }).finally(() => {
      retrying.current = false;
    });
  }, [start]);

  const pause = useCallback((next: boolean) => {
    paused.current = next;
    setState((s) => (s?.kind === "running" ? { ...s, paused: next } : s));
  }, []);

  const dismiss = useCallback(() => {
    stopped.current = true;
    if (conversationId) writeSaved(conversationId, null);
    setState(null);
  }, [conversationId]);

  // After a restart there's no job here, only the record of how far the last one got.
  const saved = conversationId ? readSaved(conversationId) : null;
  const live = owner === conversationId ? state : null;
  return { canRetry: !!lastPlan.current, retry, dialogOpen, setDialogOpen, state: live ?? (saved ? { kind: "stopped" as const, ...saved } : null), start, pause, dismiss };
}
