/**
 * The games Gryt knows by name, shipped in `games.json`. Rich Presence looks a
 * game up by its Discord application id, and automatic mode by its executable.
 */

export type GameOs = "win32" | "darwin" | "linux";

export interface GameEntry {
  name: string;
  /** App ids the game sends over the Rich Presence socket. */
  ids: string[];
  /** Lowercase file names. On macOS an `.app` bundle name. */
  exe: Partial<Record<GameOs, string[]>>;
  /** "app" for something like Figma, which reads "Using" rather than "Playing". */
  kind?: "game" | "app";
}

const OSES: readonly GameOs[] = ["win32", "darwin", "linux"];

/** Linux cuts a process name to fifteen characters in `/proc/<pid>/comm`. */
const LINUX_COMM_LENGTH = 15;

/** The file off disk, checked, so a bad entry is one game missing rather than a crash. */
export function readGameList(value: unknown): GameEntry[] {
  const games = (value as { games?: unknown } | null)?.games;
  if (!Array.isArray(games)) return [];
  const out: GameEntry[] = [];
  for (const raw of games) {
    const entry = raw as Record<string, unknown> | null;
    const name = typeof entry?.name === "string" ? entry.name.trim().slice(0, 64) : "";
    if (!name) continue;
    const ids = Array.isArray(entry?.ids)
      ? entry.ids.filter((id): id is string => typeof id === "string" && /^\d{1,32}$/.test(id))
      : [];
    const exe: GameEntry["exe"] = {};
    const exeRecord = (entry?.exe ?? {}) as Record<string, unknown>;
    for (const os of OSES) {
      const list = exeRecord[os];
      if (!Array.isArray(list)) continue;
      const names = list
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        .map((n) => n.trim().toLowerCase());
      if (names.length) exe[os] = names;
    }
    const game: GameEntry = { name, ids, exe };
    if (entry?.kind === "app") game.kind = "app";
    out.push(game);
  }
  return out;
}

export interface GameIndex {
  nameForApp(appId: string): string | null;
  /** Names of listed games among these running executables, each once. */
  matchRunning(running: readonly string[]): string[];
}

/** What a running process is called, for comparing: the last path segment, lowercased. */
export function processKeys(raw: string, platform: NodeJS.Platform): string[] {
  const path = raw.trim().replace(/\\/g, "/").toLowerCase();
  if (!path) return [];
  const segments = path.split("/").filter(Boolean);
  const keys = [segments[segments.length - 1] ?? ""];
  // A Mac game is known by its bundle, and `ps` gives the binary inside it.
  if (platform === "darwin") keys.push(...segments.filter((s) => s.endsWith(".app")));
  return keys.filter(Boolean);
}

export function createGameIndex(games: readonly GameEntry[], platform: NodeJS.Platform = process.platform): GameIndex {
  const byApp = new Map<string, string>();
  const byExe = new Map<string, string>();
  const byComm = new Map<string, string>();

  // Proton runs Windows games on Linux under their Windows names.
  const oses: GameOs[] = platform === "linux" ? ["linux", "win32"] : platform === "darwin" ? ["darwin"] : ["win32"];

  for (const game of games) {
    for (const id of game.ids) if (!byApp.has(id)) byApp.set(id, game.name);
    for (const os of oses) {
      for (const exe of game.exe[os] ?? []) {
        if (!byExe.has(exe)) byExe.set(exe, game.name);
        if (platform === "linux" && exe.length > LINUX_COMM_LENGTH) {
          const cut = exe.slice(0, LINUX_COMM_LENGTH);
          if (!byComm.has(cut)) byComm.set(cut, game.name);
        }
      }
    }
  }

  return {
    nameForApp: (appId) => byApp.get(appId) ?? null,
    matchRunning(running) {
      const found = new Set<string>();
      for (const raw of running) {
        for (const key of processKeys(raw, platform)) {
          const name = byExe.get(key) ?? (key.length === LINUX_COMM_LENGTH ? byComm.get(key) : undefined);
          if (name) found.add(name);
        }
      }
      return [...found];
    },
  };
}
