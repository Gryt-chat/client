/**
 * Which of the programs you asked about are running. Reads the process list and
 * never passes it on — a plugin gets "yes to one you listed", not the list.
 */

import { execFile } from "child_process";
import { readdir, readFile } from "fs/promises";
import { basename } from "path";

/** One thing you asked to be told about. */
export interface WatchedProgram {
  /**
   * The executable as you would name it. Normalised before comparing, so
   * `factorio`, `Factorio.exe` and `/usr/games/factorio` are one entry.
   */
  match: string;
  /** What to call it on screen. `Factorio`, not `factorio.exe`. */
  name: string;
}

/**
 * How often to look. Seconds rather than milliseconds because this spawns a
 * process and the thing it watches for changes on the scale of launching a game.
 */
export const DEFAULT_INTERVAL_MS = 10_000;

/** Nobody needs to watch for two hundred programs, and every one is a comparison. */
export const MAX_WATCHED = 32;

/**
 * Path to last segment, `.exe` off, lowercased. Matching case-sensitively would
 * mean `factorio` never matching the `Factorio.exe` somebody actually runs.
 */
export function normaliseExecutable(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  return basename(trimmed).replace(/\.exe$/i, "").toLowerCase();
}

/**
 * Which watched programs are in this list of running executables. Names in
 * watch order, deduplicated: two entries for one executable are one answer.
 */
export function matchWatched(
  running: readonly string[],
  watched: readonly WatchedProgram[],
): string[] {
  const open = new Set(running.map(normaliseExecutable).filter(Boolean));
  const names: string[] = [];
  const seen = new Set<string>();

  for (const entry of watched) {
    const key = normaliseExecutable(entry.match);
    if (!key || !open.has(key) || seen.has(key)) continue;
    seen.add(key);

    const name = entry.name.trim() || entry.match.trim();
    if (name) names.push(name);
  }

  return names;
}

/**
 * A watch list off disk, which is to say not to be trusted. A `match` that is a
 * number should give a shorter list rather than a crash on the next poll.
 */
export function readWatchList(value: unknown): WatchedProgram[] {
  if (!Array.isArray(value)) return [];

  const out: WatchedProgram[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const match = typeof record.match === "string" ? record.match.trim().slice(0, 120) : "";
    if (!match) continue;

    const key = normaliseExecutable(match);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const name = typeof record.name === "string" ? record.name.trim().slice(0, 80) : "";
    out.push({ match, name: name || match });

    if (out.length >= MAX_WATCHED) break;
  }

  return out;
}

/* ── Reading the list ────────────────────────────────────────────────── */

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      {
        // A megabyte of process names is already far more than any machine has,
        // and the alternative to a cap is an unbounded buffer on a timer.
        maxBuffer: 1024 * 1024,
        // Without this every poll flashes a console window on Windows. Ten
        // seconds apart, forever, on somebody's gaming machine.
        windowsHide: true,
        timeout: 5_000,
      },
      (err, stdout) => resolve(err ? "" : stdout),
    );
  });
}

/**
 * Every running executable, as bare names. A failure is an empty list, not a
 * throw: this is on a timer, and one failed `ps` should cost one cycle.
 */

/**
 * Linux, out of `/proc`. `comm` is truncated to fifteen characters, so a long
 * executable typed by hand never matches. `userOnly` drops kernel threads.
 */
async function listLinuxProcesses(userOnly: boolean): Promise<string[]> {
  try {
    const entries = await readdir("/proc");
    const names = await Promise.all(
      entries
        .filter((entry) => /^\d+$/.test(entry))
        .map(async (pid) => {
          try {
            if (userOnly) {
              const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8");
              if (!cmdline.replace(/\0/g, "").trim()) return "";
            }
            return (await readFile(`/proc/${pid}/comm`, "utf8")).trim();
          } catch {
            /* The process exited between the readdir and the read, which is
               the normal case rather than an error. */
            return "";
          }
        }),
    );
    return names.filter(Boolean);
  } catch {
    return [];
  }
}

export async function listRunningExecutables(): Promise<string[]> {
  if (process.platform === "linux") return listLinuxProcesses(false);

  if (process.platform === "win32") {
  /* CSV rather than the table: the table pads with spaces and its column
     widths depend on the longest row. */
    const out = await run("tasklist.exe", ["/nh", "/fo", "csv"]);
    return out
      .split(/\r?\n/)
      .map((line) => line.split('","')[0]?.replace(/^"/, "").trim() ?? "")
      .filter(Boolean);
  }

  /* `comm=` is the executable path with no header and no arguments — arguments
     would put whatever somebody typed on a command line into this list. */
  const out = await run("ps", ["-axo", "comm="]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/*
 * Chromium and Electron apps run child processes named after the parent.
 * Somebody picking a program wants Discord, not "Discord Helper (Renderer)".
 */
const HELPER = /\s(Helper|Renderer|Plugin|GPU|Crashpad)\b|\(Renderer\)|\(Plugin\)|\(GPU\)/i;

/*
 * Windows service hosts. Every machine runs a dozen and none of them is a thing
 * a person launched.
 */
const WINDOWS_NOISE = new Set([
  "svchost", "dllhost", "conhost", "runtimebroker", "sihost", "taskhostw",
  "csrss", "wininit", "winlogon", "services", "lsass", "smss", "fontdrvhost",
  "dwm", "ctfmon", "searchhost", "shellexperiencehost", "backgroundtaskhost",
  "registry", "memory compression", "system idle process", "system",
]);

/**
 * Whether this looks like something a person opened. Only decides what a picker
 * offers, so anything dropped too eagerly can still be typed in by hand.
 */
function looksLikeAnApp(raw: string): boolean {
  const name = basename(raw.replace(/\\/g, "/"));
  if (HELPER.test(name)) return false;

  if (process.platform === "darwin") {
    if (!raw.includes(".app/Contents/MacOS/")) return false;
    // Apple's own agents are app bundles too, and none of them is a game.
    return !raw.startsWith("/System/");
  }

  if (process.platform === "win32") {
    return !WINDOWS_NOISE.has(normaliseExecutable(name));
  }

  return true;
}

/**
 * What is running, for a person choosing what to watch. The only function here
 * that hands a list of programs anywhere, and it goes to the settings screen.
 */
export async function listRunningPrograms(): Promise<string[]> {
  const running =
    process.platform === "linux"
      ? await listLinuxProcesses(true)
      : await listRunningExecutables();
  const seen = new Map<string, string>();

  for (const raw of running) {
    if (!looksLikeAnApp(raw)) continue;
    const key = normaliseExecutable(raw);
    if (!key || seen.has(key)) continue;
    /* The name as the OS spells it, so somebody picking from this list sees
       `Factorio.exe` rather than `factorio` and recognises it. */
    seen.set(key, basename(raw.replace(/\\/g, "/")));
  }

  return [...seen.values()].sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0,
  );
}

/* ── The watcher ─────────────────────────────────────────────────────── */

export interface ProcessWatcher {
  /** Replace the list. An empty list stops the polling entirely. */
  watch(programs: readonly WatchedProgram[]): void;
  /** What matched at the last poll. */
  current(): string[];
  stop(): void;
}

interface WatcherOptions {
  intervalMs?: number;
  /** Called only when the answer changes, never on every poll. */
  onChange: (running: string[]) => void;
  /** Injected so a test does not need a machine with the right things open. */
  list?: () => Promise<string[]>;
}

export function createProcessWatcher({
  intervalMs = DEFAULT_INTERVAL_MS,
  onChange,
  list = listRunningExecutables,
}: WatcherOptions): ProcessWatcher {
  let watched: WatchedProgram[] = [];
  let matched: string[] = [];
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  /* `ps` on a loaded machine can take longer than the interval, and two
     overlapping polls would spawn two processes for the same question. */
  let polling = false;

  function announce(next: string[]): void {
    if (next.length === matched.length && next.every((name, i) => name === matched[i])) return;
    matched = next;
    onChange([...matched]);
  }

  async function poll(): Promise<void> {
    if (polling || stopped) return;
    polling = true;
    try {
      announce(matchWatched(await list(), watched));
    } finally {
      polling = false;
    }
  }

  function schedule(): void {
    if (timer || stopped || watched.length === 0) return;
    timer = setInterval(() => void poll(), intervalMs);
    /* Never the reason the app stays alive. Without this an Electron main
       process with nothing else to do would be held open by the poll. */
    timer.unref?.();
  }

  function halt(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    watch(programs) {
      watched = [...programs];

      if (watched.length === 0) {
        /* Nothing to look for, so stop looking — and say so, because whatever
           was matching a moment ago is not any more. */
        halt();
        announce([]);
        return;
      }

      schedule();
      /* Immediately as well as on the interval, so adding a program you are
         already running does not sit there doing nothing for ten seconds. */
      void poll();
    },
    current() {
      return [...matched];
    },
    stop() {
      stopped = true;
      halt();
    },
  };
}
