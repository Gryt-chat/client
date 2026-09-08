import { randomBytes } from "crypto";
import { createSocket } from "dgram";
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
  /** Separate from `sfuPort`, which is signalling over TCP. Chat and joining both
      work without this, so a server with it shut looks healthy. */
  mediaPort: number;
  dataDir: string;
  configPath: string;
  jwtSecret: string;
  lanDiscoverable: boolean;
  externalHost: string;
  advertisedAddresses: string[];
  customAdvertisedAddresses: string[];
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

/** Readable on disk, which a bare uuid is not, but the random suffix is what
    keeps two servers apart: two called "My Server" is the expected case. */
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

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

/** Wildcard and loopback are different bindings and both can succeed, so
    checking either alone handed a server a port somebody else answered on. */
async function portIsFree(port: number): Promise<boolean> {
  if (!(await canBind(port, "0.0.0.0"))) return false;
  return canBind(port, "127.0.0.1");
}

/** An OS-assigned port, as a starting point rather than an answer. */
function ephemeralPort(host: string): Promise<number> {
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

async function findFreePortFrom(preferred: number): Promise<number> {
  if (preferred > 0 && (await portIsFree(preferred))) return preferred;

  // The OS only promises the port is free on the interface it was asked about,
  // so its answer is still checked against both.
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = await ephemeralPort("0.0.0.0");
    if (await portIsFree(port)) return port;
  }

  throw new Error("No free port");
}

/** 3478 is the IANA STUN port: no privileged bind, and the UDP port a locked-down
    network is most likely to have open, since Teams and Zoom need it. */
export const DEFAULT_MEDIA_PORT = 3478;

/** Whether a UDP port can be bound. TCP and UDP are separate sockets. */
function udpPortIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createSocket({ type: "udp4", reuseAddr: false });
    sock.once("error", () => {
      sock.close(() => resolve(false));
    });
    sock.bind(port, "0.0.0.0", () => {
      sock.close(() => resolve(true));
    });
  });
}

/** Walks upward rather than asking the OS for anything free: this is a number
    somebody types into a router, and 3479 beats 54162 for that. */
async function findFreeMediaPortFrom(preferred: number): Promise<number> {
  const start = preferred > 0 && preferred <= 65535 ? preferred : DEFAULT_MEDIA_PORT;

  for (let port = start; port < start + 50 && port <= 65535; port++) {
    if (await udpPortIsFree(port)) return port;
  }

  // Nothing in the run was free, so keep the documented port: the SFU fails to
  // bind and says so, rather than coming up somewhere nobody forwarded.
  return start;
}

/** The media port the SFU already running on this machine is using, if any. */
function existingMediaPort(): number | null {
  for (const id of listServerIds()) {
    const config = loadConfig(id);
    if (config?.mediaPort) return config.mediaPort;
  }
  return null;
}

/**
 * Walks upward rather than taking an ephemeral port: these are numbers somebody
 * types into a router, and ports no longer move after a server picks one.
 */
async function findFriendlyPortFrom(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 50 && port <= 65535; port++) {
    if (await portIsFree(port)) return port;
  }
  return findFreePortFrom(0);
}

/** A free port to offer in the create form. */
export async function suggestServerPort(preferred = 5000): Promise<number> {
  return findFriendlyPortFrom(preferred);
}

/** Whether a port somebody typed can actually be bound. */
export function isPortAvailable(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve(false);
  }
  return portIsFree(port);
}

/** A port the server needs and cannot have. */
export interface PortConflict {
  /** Which of the three, for the message and for the field to point at. */
  role: "server" | "sfu" | "media";
  port: number;
  protocol: "TCP" | "UDP";
}

/**
 * Reported rather than moved: a server that quietly left 5000 looked healthy while
 * nobody outside could reach it. The pinned SFU ports are not a move.
 */
export async function checkPortsAvailable(
  id: string,
  pinnedSfuPort?: number,
  pinnedMediaPort?: number,
): Promise<PortConflict[]> {
  const configPath = getConfigPathFor(id);
  if (!existsSync(configPath)) return [];

  let raw = readFileSync(configPath, "utf-8");
  const originalRaw = raw;
  const env = parseEnv(raw);

  const serverPort = parseInt(env.PORT || "5000", 10);
  const sfuPort = parseInt(env.SFU_PORT || "5005", 10);
  const rawMediaPort = parseInt(env.ICE_UDP_MUX_PORT || "", 10);
  const mediaPort =
    Number.isInteger(rawMediaPort) && rawMediaPort > 0
      ? rawMediaPort
      : DEFAULT_MEDIA_PORT;

  // Follow the SFU that is already running, and write that down so the file and
  // the process agree. Only reached with a second server on this machine.
  const nextSfuPort = pinnedSfuPort ?? sfuPort;
  const nextMediaPort = pinnedMediaPort ?? mediaPort;

  if (nextSfuPort !== sfuPort) {
    raw = raw
      .replace(/^SFU_PORT=.*$/m, `SFU_PORT=${nextSfuPort}`)
      .replace(/^SFU_WS_HOST=.*$/m, `SFU_WS_HOST=ws://127.0.0.1:${nextSfuPort}`);
  }
  if (nextMediaPort !== mediaPort) {
    raw = setEnvValue(raw, "ICE_UDP_MUX_PORT", String(nextMediaPort));
  }
  // Written unconditionally so a config from before the media port existed
  // gains the line, and so the UI has a number to show for it.
  if (!Number.isInteger(rawMediaPort) || rawMediaPort <= 0) {
    raw = setEnvValue(raw, "ICE_UDP_MUX_PORT", String(nextMediaPort));
  }

  raw = withAdvertisedAddresses(raw, nextSfuPort);

  if (raw !== originalRaw) {
    writeFileSync(configPath, raw, "utf-8");
  }

  const conflicts: PortConflict[] = [];

  if (!(await portIsFree(serverPort))) {
    conflicts.push({ role: "server", port: serverPort, protocol: "TCP" });
  }

  // Only when this server starts the SFU: joining a running one, the ports are
  // held by it and probing reports a conflict with ourselves.
  if (pinnedSfuPort === undefined && !(await portIsFree(nextSfuPort))) {
    conflicts.push({ role: "sfu", port: nextSfuPort, protocol: "TCP" });
  }
  if (pinnedMediaPort === undefined && !(await udpPortIsFree(nextMediaPort))) {
    conflicts.push({ role: "media", port: nextMediaPort, protocol: "UDP" });
  }

  return conflicts;
}

/** How to say a set of conflicts to somebody who has to act on it. */
export function describePortConflicts(conflicts: PortConflict[]): string {
  const label = {
    server: "the server",
    sfu: "voice signalling",
    media: "voice and video",
  } as const;

  const parts = conflicts.map(
    (c) => `${c.protocol} ${c.port} (${label[c.role]})`,
  );

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  return (
    `Something else on this machine is using ${list}. ` +
    `Close it, or change the port under Open these ports in My servers.`
  );
}

/** Refused while running, since the process holds the old ones. The SFU ports
    are shared, so changing them changes them for every server. */
export async function updateServerPorts(
  id: string,
  ports: { serverPort?: number; sfuPort?: number; mediaPort?: number },
): Promise<EmbeddedServerConfig | null> {
  const configPath = getConfigPathFor(id);
  if (!existsSync(configPath)) return null;

  const current = loadConfig(id);
  if (!current) return null;

  const serverPort = ports.serverPort ?? current.serverPort;
  const sfuPort = ports.sfuPort ?? current.sfuPort;
  const mediaPort = ports.mediaPort ?? current.mediaPort;

  for (const port of [serverPort, sfuPort, mediaPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Ports must be whole numbers between 1 and 65535");
    }
  }

  if (serverPort === sfuPort) {
    throw new Error("The server and voice signalling cannot share a TCP port");
  }

  // The media port is UDP and the other two are TCP, so it may legitimately be
  // the same number as either. Only the two TCP ports can actually collide.

  if (serverPort !== current.serverPort && !(await portIsFree(serverPort))) {
    throw new Error(`TCP ${serverPort} is already in use`);
  }
  if (sfuPort !== current.sfuPort && !(await portIsFree(sfuPort))) {
    throw new Error(`TCP ${sfuPort} is already in use`);
  }
  if (mediaPort !== current.mediaPort && !(await udpPortIsFree(mediaPort))) {
    throw new Error(`UDP ${mediaPort} is already in use`);
  }

  let raw = readFileSync(configPath, "utf-8");
  raw = setEnvValue(raw, "PORT", String(serverPort));
  raw = setEnvValue(raw, "EXTERNAL_HOST", `http://127.0.0.1:${serverPort}`);
  raw = setEnvValue(raw, "SFU_PORT", String(sfuPort));
  raw = setEnvValue(raw, "SFU_WS_HOST", `ws://127.0.0.1:${sfuPort}`);
  raw = setEnvValue(raw, "ICE_UDP_MUX_PORT", String(mediaPort));
  raw = withAdvertisedAddresses(raw, sfuPort);
  writeFileSync(configPath, raw, "utf-8");

  return loadConfig(id);
}

function parseIpv4(ip: string): number[] | null {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return null;
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

/**
 * Advertised as where to send voice, so well-formed is not enough. `0.0.0.0` is
 * what you write to listen and does the opposite here; loopback fails the same.
 */
function isDialableIpv4(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;

  const [a, b] = parts;

  if (a === 0) return false; // "this network" — 0.0.0.0 and the rest of 0/8
  if (a === 127) return false; // loopback: every machine's own, nobody else's
  if (a === 169 && b === 254) return false; // link-local, from a DHCP that never answered
  if (a >= 224) return false; // multicast, reserved, and 255.255.255.255

  return true;
}

/** Windows names virtual adapters for the product, not the driver, so the Linux
    and macOS names never matched and a VMnet address was advertised. */
const VIRTUAL_INTERFACE =
  /^(docker|br-|bridge|veth|virbr|vmnet|vmware|virtualbox|hyper-v|utun|tun|tap|tailscale|zt|wg|vboxnet|vethernet)/i;

function getIpv4Candidates(): string[] {
  const ifaces = networkInterfaces();
  const candidates: string[] = [];

  for (const name of Object.keys(ifaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const iface of ifaces[name] ?? []) {
      if (
        iface.family === "IPv4" &&
        !iface.internal &&
        isDialableIpv4(iface.address) &&
        !isCgnatOrTailscaleIp(iface.address)
      ) {
        candidates.push(iface.address);
      }
    }
  }

  return candidates;
}

export function getAdvertisedAddresses(): string[] {
  return [...new Set(getIpv4Candidates())].sort(
    (left, right) => Number(isPrivateLanIp(right)) - Number(isPrivateLanIp(left)),
  );
}

export function getLanIp(): string {
  const candidates = getAdvertisedAddresses();

  const privateLan = candidates.find(isPrivateLanIp);
  if (privateLan) return privateLan;

  const nonCgnat = candidates.find((ip) => !isCgnatOrTailscaleIp(ip));
  if (nonCgnat) return nonCgnat;

  return candidates[0] || "127.0.0.1";
}

function splitAddresses(value: string | undefined): string[] {
  return [...new Set((value ?? "").split(",").map((v) => v.trim()).filter(Boolean))];
}

function isHostname(value: string): boolean {
  return (
    value.length <= 253 &&
    value.includes(".") &&
    /[a-z]/i.test(value) &&
    value.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
    )
  );
}

function validateCustomAddress(value: string): boolean {
  return isDialableIpv4(value) || isHostname(value);
}

function setEnvValue(raw: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(raw)) return raw.replace(pattern, line);
  return `${raw.trimEnd()}\n${line}\n`;
}

function customAddressesFrom(env: Record<string, string>): string[] {
  if (Object.prototype.hasOwnProperty.call(env, "EMBEDDED_SERVER_CUSTOM_ADDRESSES")) {
    return splitAddresses(env.EMBEDDED_SERVER_CUSTOM_ADDRESSES);
  }

  // Older configs had no separate custom field. Keep deliberate public IPs
  // and hostnames, but drop the private or tunnel address the app generated.
  return splitAddresses(env.SFU_PUBLIC_HOST)
    .map(extractHostFromHostPort)
    .filter((host) =>
      isHostname(host) ||
      (isDialableIpv4(host) && !isPrivateLanIp(host) && !isCgnatOrTailscaleIp(host)),
    );
}

function withAdvertisedAddresses(raw: string, sfuPort: number): string {
  const env = parseEnv(raw);
  // On the way out as well as in, because a config written before the check still
  // has them on disk and this runs on every load.
  const custom = customAddressesFrom(env).filter(
    (address) => isHostname(address) || isDialableIpv4(address),
  );
  const effective = [...new Set([...getAdvertisedAddresses(), ...custom])];
  const fallback = effective.length > 0 ? effective : ["127.0.0.1"];

  let next = setEnvValue(
    raw,
    "EMBEDDED_SERVER_CUSTOM_ADDRESSES",
    custom.join(","),
  );
  next = setEnvValue(
    next,
    "SFU_PUBLIC_HOST",
    fallback.map((address) => `${address}:${sfuPort}`).join(","),
  );
  next = setEnvValue(
    next,
    "ICE_ADVERTISE_IP",
    effective.filter(isDialableIpv4).join(","),
  );
  return next;
}

export function updateCustomAdvertisedAddresses(
  id: string,
  addresses: string[],
): EmbeddedServerConfig | null {
  const configPath = getConfigPathFor(id);
  if (!existsSync(configPath)) return null;

  const custom = [...new Set(addresses.map((v) => v.trim()).filter(Boolean))];
  if (custom.some((value) => !validateCustomAddress(value))) {
    throw new Error(
      "Use IPv4 addresses or fully qualified hostnames without ports, and an " +
        "address other machines can reach — not 0.0.0.0 or a loopback address",
    );
  }

  let raw = readFileSync(configPath, "utf-8");
  const env = parseEnv(raw);
  const sfuPort = parseInt(env.SFU_PORT || "5005", 10);
  raw = setEnvValue(raw, "EMBEDDED_SERVER_CUSTOM_ADDRESSES", custom.join(","));
  writeFileSync(configPath, withAdvertisedAddresses(raw, sfuPort), "utf-8");
  return loadConfig(id);
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

/** One SFU serves every server on this machine, routing on the server id, so a
    new server joins the port the others use rather than asking for its own. */
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
  /** Checked here rather than trusted from the form: something else can take the
      port between the two moments. */
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
      : await findFriendlyPortFrom(5000);
  const sfuPort = existingSfuPort() ?? (await findFriendlyPortFrom(5005));
  // One SFU per app, so a second server shares the first one's media port the
  // same way it shares its signalling port.
  const mediaPort = existingMediaPort() ?? (await findFreeMediaPortFrom(DEFAULT_MEDIA_PORT));
  const jwtSecret = randomBytes(32).toString("hex");
  const advertisedAddresses = getAdvertisedAddresses();
  const lanIp = advertisedAddresses[0] || "127.0.0.1";
  const externalHost = `http://127.0.0.1:${serverPort}`;

  const envContent =
    [
      `# Gryt Embedded Server Configuration (auto-generated)`,
      `SERVER_NAME=${serverName}`,
      // Part of how the SFU tells servers apart, and belt and braces since the
      // ports differ: two sharing an identity means the second's voice never starts.
      `SERVER_INSTANCE_ID=${id}`,
      `HOST=0.0.0.0`,
      `PORT=${serverPort}`,
      `DATA_DIR=${dataDir}`,
      `STORAGE_BACKEND=filesystem`,
      `S3_BUCKET=uploads`,
      `JWT_SECRET=${jwtSecret}`,
      `SFU_PORT=${sfuPort}`,
      `SFU_WS_HOST=ws://127.0.0.1:${sfuPort}`,
      // The UDP port voice travels on and the one opened by hand; SFU_PORT above
      // is signalling over TCP. Without it pion picks ephemeral ports at random.
      `ICE_UDP_MUX_PORT=${mediaPort}`,
      `EMBEDDED_SERVER_CUSTOM_ADDRESSES=`,
      `SFU_PUBLIC_HOST=${advertisedAddresses.map((address) => `${address}:${sfuPort}`).join(",") || `${lanIp}:${sfuPort}`}`,
      `ICE_ADVERTISE_IP=${advertisedAddresses.join(",")}`,
      `STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302`,
      `CORS_ORIGIN=*`,
      `EXTERNAL_HOST=${externalHost}`,
      // Accept people with no Gryt account. Not a wide-open door: the join policy
      // still starts invite-only, so an invited person just needs no account.
      `GRYT_IDENTITY_TIERS=account,local`,
      // Seeds `discoverable` on the first run only, so a later change in server
      // settings still wins. Replaces MDNS_ENABLED, which nothing ever read.
      `SERVER_DISCOVERABLE=${lanDiscoverable ? "true" : "false"}`,
      // The same cap SFU_UDP_PORT_MIN/MAX used to express as (max-min+1), which
      // looked like a media setting and the SFU never read.
      `VOICE_MAX_USERS=20`,
    ].join("\n") + "\n";

  writeFileSync(configPath, envContent, "utf-8");

  return {
    id,
    serverName,
    serverPort,
    sfuPort,
    mediaPort,
    dataDir,
    configPath,
    jwtSecret,
    lanDiscoverable,
    externalHost,
    advertisedAddresses,
    customAdvertisedAddresses: [],
  };
}

export function loadConfig(id: string): EmbeddedServerConfig | null {
  const configPath = getConfigPathFor(id);
  if (!existsSync(configPath)) return null;

  const originalRaw = readFileSync(configPath, "utf-8");
  const originalEnv = parseEnv(originalRaw);
  const sfuPort = parseInt(originalEnv.SFU_PORT || "5005", 10);
  const raw = withAdvertisedAddresses(originalRaw, sfuPort);
  if (raw !== originalRaw) writeFileSync(configPath, raw, "utf-8");
  const env = parseEnv(raw);
  const customAdvertisedAddresses = customAddressesFrom(env);
  const advertisedAddresses = [
    ...new Set([...getAdvertisedAddresses(), ...customAdvertisedAddresses]),
  ];

  return {
    id,
    serverName: env.SERVER_NAME || "My Server",
    serverPort: parseInt(env.PORT || "5000", 10),
    sfuPort: parseInt(env.SFU_PORT || "5005", 10),
    // Older configs have no line for this, so they report the SFU's own default —
    // which is what those servers are really using.
    mediaPort: parseInt(env.ICE_UDP_MUX_PORT || "", 10) || DEFAULT_MEDIA_PORT,
    dataDir: env.DATA_DIR || join(getServerDir(id), "data"),
    configPath,
    jwtSecret: env.JWT_SECRET || "",
    lanDiscoverable: (env.SERVER_DISCOVERABLE || "").toLowerCase() !== "false",
    externalHost: env.EXTERNAL_HOST || `http://127.0.0.1:${env.PORT || "5000"}`,
    advertisedAddresses,
    customAdvertisedAddresses,
  };
}

/**
 * The messages, members, uploads and identity key, with no second copy anywhere.
 * Anybody who joined pinned that key, so a recreated server is a different one.
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
