import { randomBytes } from "crypto";
import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { createServer } from "net";
import { networkInterfaces } from "os";
import { join } from "path";

export interface EmbeddedServerConfig {
  serverName: string;
  serverPort: number;
  sfuPort: number;
  dataDir: string;
  configPath: string;
  jwtSecret: string;
  lanDiscoverable: boolean;
  externalHost: string;
}

const BASE_DIR_NAME = "gryt-server";

export function getEmbeddedServerDir(): string {
  return join(app.getPath("userData"), BASE_DIR_NAME);
}

function getConfigPath(): string {
  return join(getEmbeddedServerDir(), "config.env");
}

export function hasExistingServer(): boolean {
  return existsSync(getConfigPath());
}

function findFreePort(preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();

    srv.listen(preferred, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : preferred;
      srv.close(() => resolve(port));
    });

    srv.on("error", () => {
      srv.listen(0, "127.0.0.1", () => {
        const addr = srv.address();
        const port = typeof addr === "object" && addr ? addr.port : 0;
        srv.close(() =>
          port ? resolve(port) : reject(new Error("No free port")),
        );
      });
    });
  });
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
 * Re-check the ports recorded in config.env and move off any that are taken.
 *
 * Ports were previously chosen once, when the server was created, and reused
 * forever. Anything else claiming one in the meantime broke the server on every
 * subsequent start with no way to recover from the UI. On macOS that is not
 * hypothetical: AirPlay Receiver binds 5000, which is the preferred default.
 *
 * SFU_WS_HOST and SFU_PUBLIC_HOST embed the SFU port, so they move with it.
 */
export async function ensurePortsAvailable(): Promise<string[]> {
  const configPath = getConfigPath();
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
    notes.push(`server port ${serverPort} was in use, moved to ${nextServerPort}`);
  }

  const nextSfuPort = await findFreePortFrom(sfuPort, host);
  if (nextSfuPort !== sfuPort) {
    raw = raw
      .replace(/^SFU_PORT=.*$/m, `SFU_PORT=${nextSfuPort}`)
      .replace(/^SFU_WS_HOST=.*$/m, `SFU_WS_HOST=ws://127.0.0.1:${nextSfuPort}`)
      .replace(
        /^SFU_PUBLIC_HOST=.*$/m,
        `SFU_PUBLIC_HOST=${extractHostFromHostPort(env.SFU_PUBLIC_HOST || getLanIp())}:${nextSfuPort}`,
      );
    notes.push(`SFU port ${sfuPort} was in use, moved to ${nextSfuPort}`);
  }

  if (notes.length > 0) {
    writeFileSync(configPath, raw, "utf-8");
    for (const n of notes) console.log(`[EmbeddedServerConfig] ${n}`);
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

export async function generateConfig(
  serverName: string,
  lanDiscoverable: boolean,
): Promise<EmbeddedServerConfig> {
  const baseDir = getEmbeddedServerDir();
  const dataDir = join(baseDir, "data");
  const configPath = getConfigPath();

  mkdirSync(dataDir, { recursive: true });

  const serverPort = await findFreePort(5000);
  const sfuPort = await findFreePort(5005);
  const jwtSecret = randomBytes(32).toString("hex");
  const lanIp = getLanIp();
  const externalHost = `http://127.0.0.1:${serverPort}`;

  const envContent =
    [
      `# Gryt Embedded Server Configuration (auto-generated)`,
      `SERVER_NAME=${serverName}`,
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

export function loadExistingConfig(): EmbeddedServerConfig | null {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return null;

  migrateExistingConfigIfNeeded(configPath);

  const raw = readFileSync(configPath, "utf-8");
  const env = parseEnv(raw);

  return {
    serverName: env.SERVER_NAME || "My Server",
    serverPort: parseInt(env.PORT || "5000", 10),
    sfuPort: parseInt(env.SFU_PORT || "5005", 10),
    dataDir: env.DATA_DIR || join(getEmbeddedServerDir(), "data"),
    configPath,
    jwtSecret: env.JWT_SECRET || "",
    lanDiscoverable: (env.SERVER_DISCOVERABLE || "").toLowerCase() !== "false",
    externalHost: env.EXTERNAL_HOST || `http://127.0.0.1:${env.PORT || "5000"}`,
  };
}
