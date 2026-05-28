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

  if (!isCgnatOrTailscaleIp(currentHost)) return;
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
      `IDENTITY_MODE=builtin`,
      lanDiscoverable ? `MDNS_ENABLED=true` : `# MDNS_ENABLED=false`,
      `SFU_UDP_PORT_MIN=10000`,
      `SFU_UDP_PORT_MAX=10019`,
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
    lanDiscoverable: env.MDNS_ENABLED === "true",
    externalHost: env.EXTERNAL_HOST || `http://127.0.0.1:${env.PORT || "5000"}`,
  };
}
