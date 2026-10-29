import { type DiscordPackageDm, type DiscordPackageMessage, isDiscordPackage, linksExpireAt, listDiscordDms, readDiscordDm } from "@gryt/core";
import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";

import { sealAttachment } from "@/common";

import { uploadChatFile } from "../hooks/uploadChatFile";
import type { MlsSource } from "../mls/serverMls";
import { type ImportProgress, runDiscordImport } from "./discordImportJob";
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
      downloadsDoneAt: number | null;
      sendingLeftMs: number | null;
      linksUntil: number | null;
      peerAdded: boolean;
    }
  | { kind: "asked"; by: string }
  | { kind: "missing"; files: number; imported: number; linksUntil: number | null }
  | { kind: "done"; mine: number; theirs: number | null; files: number; firstAt: number; lastAt: number };

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

function running(p: ImportProgress, plan: DiscordImportPlan, paused: boolean, peerAdded: boolean): Extract<DiscordImportState, { kind: "running" }> {
  const seconds = Math.max(1, (Date.now() - p.startedAt) / 1000);
  const bytesPerSecond = p.bytes / seconds;
  const perFile = p.downloaded.done ? (Date.now() - p.startedAt) / p.downloaded.done : null;
  const perSent = p.sent.done ? (Date.now() - p.startedAt) / p.sent.done : null;
  return {
    kind: "running",
    paused,
    messages: p.messages,
    downloaded: p.downloaded,
    sent: p.sent,
    bytesPerSecond,
    downloadsDoneAt: perFile === null ? null : Date.now() + perFile * (p.downloaded.total - p.downloaded.done),
    sendingLeftMs: perSent === null ? null : perSent * (p.sent.total - p.sent.done),
    linksUntil: plan.linksUntil,
    peerAdded,
  };
}

/** One DM's import, while this window is open (GRYT-1965). Re-running is safe: ids come from Discord's. */
export function useDiscordImport({ host, conversationId, peer, source }: { host: string | undefined; conversationId: string | undefined; peer: string | undefined; source: MlsSource | null }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [state, setState] = useState<DiscordImportState | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const paused = useRef(false);
  const stopped = useRef(false);

  const start = useCallback(async (plan: DiscordImportPlan) => {
    if (!host || !conversationId || !peer || !source) return;
    paused.current = false;
    stopped.current = false;
    setOwner(conversationId);
    const cache = await caches.open("gryt-discord-import");
    const report = (p: ImportProgress) => setState(running(p, plan, paused.current, false));
    const done = await runDiscordImport(plan.messages, {
      send: async (content) => { await source.send(conversationId, peer, content); },
      upload: async (file) => {
        const up = await uploadChatFile(file, host, await getMediaDimensions(file), (bytes, about) => sealAttachment({ bytes, conversationId, ...about }));
        if (!up.meta) throw new Error("The file was uploaded without its key.");
        return { id: up.fileId, key: up.meta };
      },
      fetchFile: (url) => fetch(url),
      cache,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    }, { paused: () => paused.current, stopped: () => stopped.current }, report).catch((e: Error) => {
      toast.error(e instanceof Error ? `The import stopped: ${e.message}` : "The import stopped.");
      return null;
    });
    if (!done || stopped.current) return;
    setState(done.missing
      ? { kind: "missing", files: done.downloaded.total, imported: done.downloaded.total - done.missing, linksUntil: plan.linksUntil }
      : { kind: "done", mine: plan.messages.length, theirs: null, files: done.sent.total, firstAt: plan.dm.firstAt, lastAt: plan.dm.lastAt });
  }, [host, conversationId, peer, source]);

  const pause = useCallback((next: boolean) => {
    paused.current = next;
    setState((s) => (s?.kind === "running" ? { ...s, paused: next } : s));
  }, []);

  const dismiss = useCallback(() => {
    stopped.current = true;
    setState(null);
  }, []);

  return { dialogOpen, setDialogOpen, state: owner === conversationId ? state : null, start, pause, dismiss };
}
