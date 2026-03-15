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
          port ? resolve(port) : reject(new Error("No free port"))
        );
      });
    });
  });
}

export function getLanIp(): string {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

export async function generateConfig(
  serverName: string,
  lanDiscoverable: boolean
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

  const raw = readFileSync(configPath, "utf-8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }

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
