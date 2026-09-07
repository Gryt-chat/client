/**
 * Which of the programs you asked about are running (GRYT-931).
 *
 * ## The decision this file is
 *
 * A plugin wanting to say "playing Factorio" needs the process list, and the
 * renderer has no way to ask for one — `contextIsolation` is on, `nodeIntegration`
 * is off, and nothing process-shaped is on `electronAPI`. That is deliberate, so
 * the question was never "how do we expose the process list" but "what is the
 * smallest thing that makes a now-playing plugin possible".
 *
 * **It is not the process list.** The list of every program you have open is a
 * remarkably personal document: which bank, which browser, which chat app,
 * whether you are running a CV editor at eleven on a Tuesday. Handing that to a
 * plugin, or even to the renderer, to get one game name out of it is the wrong
 * trade by a distance.
 *
 * So this reads the list and never passes it on. You write down the programs you
 * want seen; Gryt reports which of *those* are running and nothing else. The
 * capability a plugin asks for can then honestly read "see when you are running
 * a program you have listed" rather than "read every program you have open",
 * because that is what it does.
 *
 * The one place the full list surfaces is `listRunningPrograms`, which the
 * settings screen calls so you can pick from what is open rather than guessing
 * at an executable name. That goes to the person about their own machine, on
 * demand, and never to a plugin.
 *
 * ## What it costs
 *
 * A spawn every `intervalMs`. There is no process list in Node, so this shells
 * out — `/proc` on Linux, `ps` on macOS, `tasklist` on Windows — and that is why
 * the interval is measured in seconds rather than milliseconds and why the
 * watcher stops itself when nothing is being watched for.
 */

import { execFile } from "child_process";
import { readdir, readFile } from "fs/promises";
import { basename } from "path";

/** One thing you asked to be told about. */
export interface WatchedProgram {
  /**
   * The executable, as you would name it: `factorio`, `Factorio.exe`,
   * `/usr/games/factorio`. Normalised before it is compared, so all three are
   * the same entry.
   */
  match: string;
  /** What to call it on screen. `Factorio`, not `factorio.exe`. */
  name: string;
}

/**
 * How often to look.
 *
 * Ten seconds because this runs for as long as the app does and the thing it is
 * watching for changes on the scale of launching a game. A second would be
 * thirty-six hundred spawns an hour to notice something that takes a minute to
 * load.
 */
export const DEFAULT_INTERVAL_MS = 10_000;

/** Nobody needs to watch for two hundred programs, and every one is a comparison. */
export const MAX_WATCHED = 32;

/**
 * An executable as written, reduced to the thing worth comparing.
 *
 * A path becomes its last segment, a `.exe` loses it, and case goes — so
 * `C:\\Games\\Factorio.exe`, `Factorio.EXE` and `factorio` all land on the same
 * string. Windows is case-insensitive about this and macOS usually is; matching
 * case-sensitively would mean somebody typing `factorio` never matching the
 * `Factorio.exe` they actually run, and never finding out why.
 */
export function normaliseExecutable(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, "/");
  if (!trimmed) return "";
  return basename(trimmed).replace(/\.exe$/i, "").toLowerCase();
}

/**
 * Which watched programs are in this list of running executables.
 *
 * Pure, and separated from the reading so it can be tested without a machine
 * that happens to have Factorio open. Returns the names in the order they were
 * watched, deduplicated: two entries pointing at the same executable are one
 * answer, not two.
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
 * A watch list as it comes back off disk, which is to say not to be trusted.
 *
 * `gryt-global.json` is a file on the person's own machine, so this is about
 * surviving an edit rather than about an attacker — but a `match` that is a
 * number, or a list of nine thousand entries, should produce a shorter list
 * rather than a crash on the next poll.
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
 * Every running executable, as bare names.
 *
 * Linux reads `/proc` rather than spawning, which is both cheaper and the only
 * one of the three that can be done without a subprocess. The other two shell
 * out because there is no other way.
 *
 * A failure is an empty list, not a throw. This is on a timer for the life of
 * the app: a `ps` that fails once should mean one poll that found nothing, and
 * a watcher that stops on the first hiccup is worse than one that misses a
 * cycle. The cost is that "nothing matched" and "could not look" are the same
 * answer, which is why nothing here reports a game *stopping* as a fact — it
 * reports the list, and the caller sees it shrink.
 */
export async function listRunningExecutables(): Promise<string[]> {
  if (process.platform === "linux") {
    try {
      const entries = await readdir("/proc");
      const names = await Promise.all(
        entries
          .filter((entry) => /^\d+$/.test(entry))
          .map(async (pid) => {
            try {
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

  if (process.platform === "win32") {
    /* CSV rather than the table, because the table pads with spaces and its
       column widths depend on the longest row. The first field is the image
       name; the quotes come off with the split. */
    const out = await run("tasklist.exe", ["/nh", "/fo", "csv"]);
    return out
      .split(/\r?\n/)
      .map((line) => line.split('","')[0]?.replace(/^"/, "").trim() ?? "")
      .filter(Boolean);
  }

  /* macOS and anything else with a `ps`. `comm=` is the executable path with no
     header and no arguments — arguments would put whatever somebody typed on a
     command line into this list, and none of it is wanted. */
  const out = await run("ps", ["-axo", "comm="]);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/*
 * Chromium and Electron apps run a handful of child processes each, all named
 * after the parent. Somebody picking a program wants Discord, not "Discord
 * Helper (Renderer)" three times.
 */
const HELPER = /\s(Helper|Renderer|Plugin|GPU|Crashpad)\b|\(Renderer\)|\(Plugin\)|\(GPU\)/i;

/*
 * Windows service hosts. Every machine runs a dozen `svchost.exe` and none of
 * them is a thing a person launched or would recognise.
 */
const WINDOWS_NOISE = new Set([
  "svchost", "dllhost", "conhost", "runtimebroker", "sihost", "taskhostw",
  "csrss", "wininit", "winlogon", "services", "lsass", "smss", "fontdrvhost",
  "dwm", "ctfmon", "searchhost", "shellexperiencehost", "backgroundtaskhost",
  "registry", "memory compression", "system idle process", "system",
]);

/**
 * Whether this looks like something a person opened, rather than plumbing.
 *
 * Cannot be exact, and does not have to be: this only decides what is offered
 * in a picker. Anything filtered out too eagerly can still be typed in by hand,
 * which is why the settings screen keeps a text field beside the list.
 *
 * macOS is the one that can be answered well — a program somebody launched is
 * an `.app` bundle, and everything else under `/usr/libexec` and `/System` is
 * a daemon. 1178 processes come down to about 40 that way. Windows gets a deny
 * list because `tasklist` gives bare names with no path to judge by, and Linux
 * gets nothing, because `/proc/comm` is bare names too and there is no
 * convention to lean on.
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
 * What is running, for a person choosing what to watch.
 *
 * Deduplicated and sorted, because the raw list is one entry per process and a
 * browser is thirty of them. This is the only function here that hands a list
 * of programs anywhere, and it goes to the settings screen — the person, about
 * their own machine, when they asked for it. Never to a plugin.
 */
export async function listRunningPrograms(): Promise<string[]> {
  const running = await listRunningExecutables();
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
  /* Set while a poll is in flight. `ps` on a loaded machine can take longer
     than the interval, and two overlapping polls would spawn two processes to
     answer the same question. */
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
