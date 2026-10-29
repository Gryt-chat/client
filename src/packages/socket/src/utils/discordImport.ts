import { useCallback, useEffect, useState } from "react";

/** One DM found in somebody's Discord data package (GRYT-1965). Only their own messages are in it. */
export interface DiscordDm {
  channelId: string;
  name: string;
  messages: number;
  files: number;
  bytes: number;
  firstAt: number;
  lastAt: number;
}

export interface DiscordImportPlan {
  dm: DiscordDm;
  /** When Discord's file links stop working, from the `ex` in them. Null when they carry none. */
  linksUntil: number | null;
  freeBytes: number | null;
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
      downloadsDoneAt: number;
      sendingLeftMs: number;
      linksUntil: number | null;
      peerAdded: boolean;
    }
  | { kind: "asked"; by: string; messages: number }
  | { kind: "missing"; files: number; imported: number; linksUntil: number }
  | { kind: "done"; mine: number; theirs: number | null; files: number; firstAt: number; lastAt: number };

const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

/** shortcut: fake data until the package reader exists; replace once a real package has been read. */
export const SAMPLE_DMS: DiscordDm[] = [
  { channelId: "1", name: "mira.k", messages: 48_213, files: 3_912, bytes: 14.2e9, firstAt: day(2019, 3, 3), lastAt: day(2026, 10, 1) },
  { channelId: "2", name: "carlo_dev", messages: 2_104, files: 61, bytes: 0.31e9, firstAt: day(2023, 2, 9), lastAt: day(2026, 9, 20) },
  { channelId: "3", name: "al.b", messages: 812, files: 9, bytes: 0.02e9, firstAt: day(2024, 6, 1), lastAt: day(2026, 8, 30) },
];

export function samplePlan(dm: DiscordDm, now = Date.now()): DiscordImportPlan {
  return { dm, linksUntil: now + 22 * 3_600_000, freeBytes: 212e9 };
}

export function sampleRunning(plan: DiscordImportPlan, now = Date.now()): Extract<DiscordImportState, { kind: "running" }> {
  const { dm } = plan;
  return {
    kind: "running",
    paused: false,
    messages: { done: Math.round(dm.messages * 0.65), total: dm.messages },
    downloaded: { done: Math.round(dm.files * 0.67), total: dm.files },
    sent: { done: Math.round(dm.files * 0.21), total: dm.files },
    bytesPerSecond: 9.8e6,
    downloadsDoneAt: now + 40 * 60_000,
    sendingLeftMs: 160 * 60_000,
    linksUntil: plan.linksUntil,
    peerAdded: false,
  };
}

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

declare global {
  interface Window {
    discordImportPreview?: (kind: "asked" | "missing" | "done") => void;
  }
}

const PREVIEWS: Record<"asked" | "missing" | "done", () => DiscordImportState> = {
  asked: () => ({ kind: "asked", by: "Sivert", messages: 48_213 }),
  missing: () => ({ kind: "missing", files: 3_912, imported: 2_708, linksUntil: Date.now() - 3_600_000 }),
  done: () => ({ kind: "done", mine: 48_213, theirs: 31_880, files: 3_912, firstAt: day(2019, 3, 3), lastAt: day(2026, 10, 1) }),
};

/** shortcut: preview state for the import UI, kept in memory per conversation until the import job exists. */
export function useDiscordImportPreview(conversationId: string | undefined) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [states, setStates] = useState<Record<string, DiscordImportState>>({});
  const state = conversationId ? states[conversationId] ?? null : null;

  const setState = useCallback((next: DiscordImportState | null) => {
    if (!conversationId) return;
    setStates((prev) => {
      const out = { ...prev };
      if (next) out[conversationId] = next;
      else delete out[conversationId];
      return out;
    });
  }, [conversationId]);

  // Dev builds: `discordImportPreview("asked" | "missing" | "done")` in the console shows the other cards.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.discordImportPreview = (kind) => setState(PREVIEWS[kind]());
    return () => { delete window.discordImportPreview; };
  }, [setState]);

  return { dialogOpen, setDialogOpen, state, setState };
}
