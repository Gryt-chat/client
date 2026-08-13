import { randomBytes } from "crypto";
import { app } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createServer } from "net";
import { networkInterfaces } from "os";
import { join } from "path";

export interface EmbeddedServerConfig {
  /** Stable handle for this server, and the name of its directory on disk. */
  id: string;
  serverName: string;
  serverPort: number;
  sfuPort: number;
  dataDir: string;
  configPath: string;
  jwtSecret: string;
  lanDiscoverable: boolean;
  externalHost: string;
}

const SERVERS_DIR_NAME = "gryt-servers";

/** Where every server lives, one directory each. */
function getServersRootDir(): string {
  return join(app.getPath("userData"), SERVERS_DIR_NAME);
}

export function getServerDir(id: string): string {
  return join(getServersRootDir(), id);
}

function getConfigPathFor(id: string): string {
  return join(getServerDir(id), "config.env");
}

/**
 * A directory name derived from what the server is called.
 *
 * Readable on disk and in logs, which a bare uuid is not, but the random suffix
 * is what actually keeps two servers apart — names are free text and two of
 * them called "My Server" is the expected case, not the odd one.
 */
function makeServerId(serverName: string): string {
  const slug = serverName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);

  return `${slug || "server"}-${randomBytes(3).toString("hex")}`;
}

export function listServerIds(): string[] {
  const ids: string[] = [];

  try {
    for (const entry of readdirSync(getServersRootDir(), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(getConfigPathFor(entry.name))) ids.push(entry.name);
    }
  } catch {
    // No servers directory yet, which is the normal state until a second
    // server is created.
  }

  return ids;
}

export function hasExistingServer(): boolean {
  return listServerIds().length > 0;
}

/**
 * Can we actually bind this port, on the interface the server will use?
 *
 * Deliberately not 127.0.0.1: the embedded server runs with HOST=0.0.0.0, and a
 * loopback probe says nothing about whether the wildcard bind will succeed.
 */
function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

async function findFreePortFrom(
  preferred: number,
  host: string,
): Promise<number> {
  if (await canBind(preferred, host)) return preferred;

  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", () => reject(new Error("No free port")));
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() =>
        port ? resolve(port) : reject(new Error("No free port")),
      );
    });
  });
}

/**
 * Re-check the ports recorded in a config and move off any that are taken.
 *
 * Ports were previously chosen once, when the server was created, and reused
 * forever. Anything else claiming one in the meantime broke the server on every
 * subsequent start with no way to recover from the UI. On macOS that is not
 * hypothetical: AirPlay Receiver binds 5000, which is the preferred default.
 *
 * SFU_WS_HOST and SFU_PUBLIC_HOST embed the SFU port, so they move with it.
 *
 * `pinnedSfuPort` is how a second server joins the SFU the first one already
 * started. There is one SFU per app, not one per server, so a server starting
 * into a running SFU must be pointed at it rather than probing for a port of
 * its own — the probe would succeed and it would sit waiting for an SFU that
 * nothing is going to start.
 */
/**
 * The interface both child processes bind, and therefore the only one worth
 * probing. A loopback probe can succeed against a port something else already
 * holds on every interface, because node sets SO_REUSEADDR — which is how a
 * new server was once handed 5005 while a dev SFU sat on it.
 */
const BIND_HOST = "0.0.0.0";

/**
 * A free port to offer in the create form.
 *
 * Walks up from 5000 rather than asking the OS for any free port. The OS gives
 * back something like 54162, which is fine for a machine and unfriendly to show
 * a person — this is a number they may have to type into a router, and 5001
 * beats 54162 for that. Falls back to whatever is free if the whole run is
 * taken, since a working port matters more than a tidy one.
 */
export async function suggestServerPort(preferred = 5000): Promise<number> {
  for (let port = preferred; port < preferred + 50; port++) {
    if (await canBind(port, BIND_HOST)) return port;
  }
  return findFreePortFrom(0, BIND_HOST);
}

/** Whether a port somebody typed can actually be bound. */
export function isPortAvailable(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve(false);
  }
  return canBind(port, BIND_HOST);
}

export async function ensurePortsAvailable(
  id: string,
  pinnedSfuPort?: number,
): Promise<string[]> {
  const configPath = getConfigPathFor(id);
  if (!existsSync(configPath)) return [];

  let raw = readFileSync(configPath, "utf-8");
  const env = parseEnv(raw);
  const host = env.HOST || "0.0.0.0";
  const notes: string[] = [];

  const serverPort = parseInt(env.PORT || "5000", 10);
  const sfuPort = parseInt(env.SFU_PORT || "5005", 10);

  const nextServerPort = await findFreePortFrom(serverPort, host);
  if (nextServerPort !== serverPort) {
    raw = raw.replace(/^PORT=.*$/m, `PORT=${nextServerPort}`);
    raw = raw.replace(
      /^EXTERNAL_HOST=.*$/m,
      `EXTERNAL_HOST=http://127.0.0.1:${nextServerPort}`,
    );
    notes.push(`server port ${serverPort} was in use, moved to ${nextServerPort}`);
  }

  const nextSfuPort =
    pinnedSfuPort ?? (await findFreePortFrom(sfuPort, host));
  if (nextSfuPort !== sfuPort) {
    raw = raw
      .replace(/^SFU_PORT=.*$/m, `SFU_PORT=${nextSfuPort}`)
      .replace(/^SFU_WS_HOST=.*$/m, `SFU_WS_HOST=ws://127.0.0.1:${nextSfuPort}`)
      .replace(
        /^SFU_PUBLIC_HOST=.*$/m,
        `SFU_PUBLIC_HOST=${extractHostFromHostPort(env.SFU_PUBLIC_HOST || getLanIp())}:${nextSfuPort}`,
      );
    notes.push(
      pinnedSfuPort
        ? `pointed at the running SFU on ${nextSfuPort}`
        : `SFU port ${sfuPort} was in use, moved to ${nextSfuPort}`,
    );
  }

  if (notes.length > 0) {
    writeFileSync(configPath, raw, "utf-8");
    for (const n of notes) console.log(`[EmbeddedServerConfig] ${id}: ${n}`);
  }

  return notes;
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return null;
  }

  return parts;
}

function isPrivateLanIp(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;

  return false;
}

function isCgnatOrTailscaleIp(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;

  const [a, b] = parts;

  // 100.64.0.0/10. This includes Tailscale-style addresses like 100.96.x.x.
  return a === 100 && b >= 64 && b <= 127;
}

function getIpv4Candidates(): string[] {
  const ifaces = networkInterfaces();
  const candidates: string[] = [];

  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        candidates.push(iface.address);
      }
    }
  }

  return candidates;
}

export function getLanIp(): string {
  const candidates = getIpv4Candidates();

  const privateLan = candidates.find(isPrivateLanIp);
  if (privateLan) return privateLan;

  const nonCgnat = candidates.find((ip) => !isCgnatOrTailscaleIp(ip));
  if (nonCgnat) return nonCgnat;

  return candidates[0] || "127.0.0.1";
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;

    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }

  return env;
}

function extractHostFromHostPort(value: string): string {
  const trimmed = value.trim();

  try {
    const withProtocol =
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.startsWith("ws://") ||
      trimmed.startsWith("wss://")
        ? trimmed
        : `ws://${trimmed}`;

    return new URL(withProtocol).hostname;
  } catch {
    return trimmed.split(":")[0] || "";
  }
}

function migrateExistingConfigIfNeeded(configPath: string): void {
  if (!existsSync(configPath)) return;

  const raw = readFileSync(configPath, "utf-8");
  const env = parseEnv(raw);

  const currentSfuPublicHost = env.SFU_PUBLIC_HOST;
  const sfuPort = env.SFU_PORT || "5005";

  if (!currentSfuPublicHost) return;

  const currentHost = extractHostFromHostPort(currentSfuPublicHost);
  const betterLanIp = getLanIp();

  // Two reasons to rewrite a stored address:
  //
  //   1. It is CGNAT/Tailscale, which the LAN cannot route to. This is what the
  //      migration was originally written for.
  //   2. It is a private LAN address that this machine no longer holds. DHCP
  //      hands out a different lease and the config keeps pointing at the old
  //      one forever — the server reports the right IP in its own UI while
  //      handing clients a dead SFU address, and joining voice fails with
  //      "SFU WebSocket connection failed".
  //
  // Anything else is left alone: a deliberately configured hostname or public
  // address is not ours to second-guess.
  const isStaleLanIp =
    isPrivateLanIp(currentHost) && !getIpv4Candidates().includes(currentHost);

  if (!isCgnatOrTailscaleIp(currentHost) && !isStaleLanIp) return;
  if (!isPrivateLanIp(betterLanIp)) return;
  if (currentHost === betterLanIp) return;

  const nextSfuPublicHost = `${betterLanIp}:${sfuPort}`;

  const nextRaw = raw.replace(
    /^SFU_PUBLIC_HOST=.*$/m,
    `SFU_PUBLIC_HOST=${nextSfuPublicHost}`,
  );

  writeFileSync(configPath, nextRaw, "utf-8");

  console.log(
    `[EmbeddedServerConfig] Migrated SFU_PUBLIC_HOST from ${currentSfuPublicHost} to ${nextSfuPublicHost}`,
  );
}

/**
 * The SFU port already agreed on by whatever servers exist.
 *
 * One SFU serves every server on this machine — it routes on the server id each
 * message carries, which is how gryt.chat runs three servers against one. So a
 * new server joins the port the others already use rather than asking for one
 * of its own; a second SFU process would be pure waste.
 */
function existingSfuPort(): number | null {
  for (const id of listServerIds()) {
    const config = loadConfig(id);
    if (config?.sfuPort) return config.sfuPort;
  }
  return null;
}

export async function generateConfig(
  serverName: string,
  lanDiscoverable: boolean,
  /**
   * The port they asked for, if they asked for one.
   *
   * Still checked here rather than trusted from the form. The form's check and
   * the create are two separate moments, and something else can take the port
   * in between — so a port that has gone since it was offered falls back to a
   * free one rather than producing a server that cannot start.
   */
  requestedPort?: number,
): Promise<EmbeddedServerConfig> {
  const id = makeServerId(serverName);
  const baseDir = getServerDir(id);
  const dataDir = join(baseDir, "data");
  const configPath = getConfigPathFor(id);

  mkdirSync(dataDir, { recursive: true });

  const serverPort =
    requestedPort && (await isPortAvailable(requestedPort))
      ? requestedPort
      : await findFreePortFrom(5000, BIND_HOST);
  const sfuPort =
    existingSfuPort() ?? (await findFreePortFrom(5005, BIND_HOST));
  const jwtSecret = randomBytes(32).toString("hex");
  const lanIp = getLanIp();
  const externalHost = `http://127.0.0.1:${serverPort}`;

  const envContent =
    [
      `# Gryt Embedded Server Configuration (auto-generated)`,
      `SERVER_NAME=${serverName}`,
      // Part of how the SFU tells one server from another: it registers as
      // SERVER_NAME_PORT_SERVER_INSTANCE_ID and keys voice rooms on that. The
      // ports already differ, so this is belt and braces — but two servers
      // sharing an identity means the second one's voice silently never
      // starts, which is not a failure worth risking on a port allocator.
      `SERVER_INSTANCE_ID=${id}`,
      `HOST=0.0.0.0`,
      `PORT=${serverPort}`,
      `DATA_DIR=${dataDir}`,
      `STORAGE_BACKEND=filesystem`,
      `S3_BUCKET=uploads`,
      `JWT_SECRET=${jwtSecret}`,
      `SFU_PORT=${sfuPort}`,
      `SFU_WS_HOST=ws://127.0.0.1:${sfuPort}`,
      `SFU_PUBLIC_HOST=${lanIp}:${sfuPort}`,
      `STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302`,
      `CORS_ORIGIN=*`,
      `EXTERNAL_HOST=${externalHost}`,
      // Accept people who have no Gryt account. IDENTITY_MODE=builtin used to
      // stand here, meaning to make this server independent of Gryt's auth; it
      // never did, because nothing ever issued a certificate in that mode and
      // its issuer was a loopback URL no other machine on the LAN could reach.
      //
      // This is the setting that actually does it. Not a wide-open door: who
      // may join is still the server's join policy, which starts at
      // invite-only, so this only means an invited person does not *also* need
      // to go and make an account first — which is the whole point of hosting
      // one of these for people in the same room.
      `GRYT_IDENTITY_TIERS=account,local`,
      // Seeds the server's `discoverable` column on its first run. Replaces
      // MDNS_ENABLED, which nothing on the server ever read — so unticking the
      // box at creation did nothing. This file is written once, at creation,
      // and the server only applies the seed while the config row does not
      // exist, so changing the setting in server settings later still wins.
      `SERVER_DISCOVERABLE=${lanDiscoverable ? "true" : "false"}`,
      // How many people fit in voice. This used to be written as
      // SFU_UDP_PORT_MIN/MAX=10000/10019, which looked like a media-plane
      // setting but was never read by the SFU — the server derived the seat
      // limit from it as (max-min+1), so those two lines were the cap, at 20,
      // wearing a costume. Same number, said plainly.
      `VOICE_MAX_USERS=20`,
    ].join("\n") + "\n";

  writeFileSync(configPath, envContent, "utf-8");

  return {
    id,
    serverName,
    serverPort,
    sfuPort,
    dataDir,
    configPath,
    jwtSecret,
    lanDiscoverable,
    externalHost,
  };
}

export function loadConfig(id: string): EmbeddedServerConfig | null {
  const configPath = getConfigPathFor(id);
  if (!existsSync(configPath)) return null;

  migrateExistingConfigIfNeeded(configPath);

  const raw = readFileSync(configPath, "utf-8");
  const env = parseEnv(raw);

  return {
    id,
    serverName: env.SERVER_NAME || "My Server",
    serverPort: parseInt(env.PORT || "5000", 10),
    sfuPort: parseInt(env.SFU_PORT || "5005", 10),
    dataDir: env.DATA_DIR || join(getServerDir(id), "data"),
    configPath,
    jwtSecret: env.JWT_SECRET || "",
    lanDiscoverable: (env.SERVER_DISCOVERABLE || "").toLowerCase() !== "false",
    externalHost: env.EXTERNAL_HOST || `http://127.0.0.1:${env.PORT || "5000"}`,
  };
}

/**
 * Remove a server's directory, and everything in it.
 *
 * This is the messages, the members, the uploads and the server's identity key.
 * There is no second copy anywhere — the caller is responsible for having
 * asked, and for having stopped the server first, because SQLite holds the file
 * open while it runs.
 *
 * Deleting the identity key is the part that is not obvious: anybody who joined
 * pinned it, so recreating a server with the same name and port is still a
 * different server to them, and they will be told it answered with the wrong
 * identity rather than let in.
 */
export function deleteServerFiles(id: string): void {
  const dir = getServerDir(id);
  // Refuse anything that is not a directory we own. `id` reaches here from IPC.
  if (!existsSync(join(dir, "config.env"))) return;
  rmSync(dir, { recursive: true, force: true });
  console.log(`[EmbeddedServerConfig] deleted ${id}`);
}

export function listServerConfigs(): EmbeddedServerConfig[] {
  return listServerIds()
    .map(loadConfig)
    .filter((c): c is EmbeddedServerConfig => c !== null);
}
