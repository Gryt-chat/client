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
  /**
   * The one UDP port every participant's audio and video actually travels on.
   *
   * Separate from `sfuPort`, which only carries signalling over TCP, and the
   * one people miss: chat and the join both work without it, so a server with
   * this port shut looks healthy right up until somebody joins voice.
   */
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

function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

/**
 * Is this port genuinely free — on the wildcard *and* on loopback?
 *
 * Both, and both matter, because they are different bindings. A process can
 * hold 127.0.0.1:5001 while another binds 0.0.0.0:5001 and neither call fails.
 * Connections to 127.0.0.1:5001 then go to the more specific of the two, which
 * is the other process — and 127.0.0.1 is exactly how the client reaches an
 * embedded server, since EXTERNAL_HOST is a loopback address.
 *
 * Checking only the wildcard produced a server that started cleanly, reported
 * its own port, and answered with somebody else's `/info`. Checking only
 * loopback is the other half of the same mistake: node sets SO_REUSEADDR, so
 * that probe succeeds against a port already held on every interface, which is
 * how a new server was once handed 5005 with a dev SFU sitting on it.
 */
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

/**
 * Where media goes when nothing says otherwise, matching the SFU's own default
 * and the number in every deployment guide.
 *
 * 3478 is the IANA STUN port. It needs no privileged bind, and it is the UDP
 * port a locked-down network is most likely to have opened already, because
 * Microsoft Teams requires outbound 3478-3481 and Zoom uses it too.
 */
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

/**
 * A free UDP port for media, starting from the one the guides name.
 *
 * Walks upward rather than asking the OS for anything free, for the same
 * reason `suggestServerPort` does: this is a number somebody may have to type
 * into a router, and 3479 beats 54162 for that. It also keeps the fallback
 * near the documented port, so a host who forwarded 3478 and then hit a
 * collision is one off rather than somewhere unrecognisable.
 */
async function findFreeMediaPortFrom(preferred: number): Promise<number> {
  const start = preferred > 0 && preferred <= 65535 ? preferred : DEFAULT_MEDIA_PORT;

  for (let port = start; port < start + 50 && port <= 65535; port++) {
    if (await udpPortIsFree(port)) return port;
  }

  // Nothing in the run was free, which is unusual enough that keeping the
  // documented port is better than picking a random one: the SFU will fail to
  // bind and say so, rather than coming up on a port nobody has forwarded.
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
    if (await portIsFree(port)) return port;
  }
  return findFreePortFrom(0);
}

/** Whether a port somebody typed can actually be bound. */
export function isPortAvailable(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.resolve(false);
  }
  return portIsFree(port);
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
 * `pinnedSfuPort` and `pinnedMediaPort` are how a second server joins the SFU
 * the first one already started. There is one SFU per app, not one per server,
 * so a server starting into a running SFU must be pointed at it rather than
 * probing for ports of its own — the probes would succeed and it would sit
 * waiting for an SFU that nothing is going to start.
 *
 * This is also where a config written before the media port existed gets one.
 * Those configs never named a UDP port at all, so the SFU fell back to its own
 * default and the host had no way to know what to forward.
 */
export async function ensurePortsAvailable(
  id: string,
  pinnedSfuPort?: number,
  pinnedMediaPort?: number,
): Promise<string[]> {
  const configPath = getConfigPathFor(id);
  if (!existsSync(configPath)) return [];

  let raw = readFileSync(configPath, "utf-8");
  const originalRaw = raw;
  const env = parseEnv(raw);
  const notes: string[] = [];

  const serverPort = parseInt(env.PORT || "5000", 10);
  const sfuPort = parseInt(env.SFU_PORT || "5005", 10);
  const mediaPort = parseInt(env.ICE_UDP_MUX_PORT || "", 10);

  const nextServerPort = await findFreePortFrom(serverPort);
  if (nextServerPort !== serverPort) {
    raw = raw.replace(/^PORT=.*$/m, `PORT=${nextServerPort}`);
    raw = raw.replace(
      /^EXTERNAL_HOST=.*$/m,
      `EXTERNAL_HOST=http://127.0.0.1:${nextServerPort}`,
    );
    notes.push(`server port ${serverPort} was in use, moved to ${nextServerPort}`);
  }

  const nextSfuPort =
    pinnedSfuPort ?? (await findFreePortFrom(sfuPort));
  if (nextSfuPort !== sfuPort) {
    raw = raw
      .replace(/^SFU_PORT=.*$/m, `SFU_PORT=${nextSfuPort}`)
      .replace(/^SFU_WS_HOST=.*$/m, `SFU_WS_HOST=ws://127.0.0.1:${nextSfuPort}`);
    notes.push(
      pinnedSfuPort
        ? `pointed at the running SFU on ${nextSfuPort}`
        : `SFU port ${sfuPort} was in use, moved to ${nextSfuPort}`,
    );
  }

  // A UDP port is not a TCP port, so this is checked with a UDP bind and moved
  // on its own. It is also the one the host has to open by hand, so a move is
  // worth saying out loud rather than logging quietly.
  const nextMediaPort =
    pinnedMediaPort ??
    (await findFreeMediaPortFrom(
      Number.isInteger(mediaPort) && mediaPort > 0 ? mediaPort : DEFAULT_MEDIA_PORT,
    ));
  if (nextMediaPort !== mediaPort) {
    raw = setEnvValue(raw, "ICE_UDP_MUX_PORT", String(nextMediaPort));
    notes.push(
      !Number.isInteger(mediaPort) || mediaPort <= 0
        ? `media is on UDP ${nextMediaPort} — open that port`
        : pinnedMediaPort
          ? `pointed at the running SFU's media port ${nextMediaPort}`
          : `UDP ${mediaPort} was in use, media moved to ${nextMediaPort} — open that port instead`,
    );
  }

  raw = withAdvertisedAddresses(raw, nextSfuPort);

  if (raw !== originalRaw) {
    writeFileSync(configPath, raw, "utf-8");
  }
  if (notes.length > 0) {
    for (const n of notes) console.log(`[EmbeddedServerConfig] ${id}: ${n}`);
  }

  return notes;
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
 * Whether anything can open a connection to this address.
 *
 * These get advertised as the place to send voice to, so an address that is
 * merely well-formed is not enough — it has to be one a packet can be
 * addressed to. `0.0.0.0` is the one people reach for, because it is what you
 * write to *listen* on every interface, and it does the opposite here: it goes
 * into ICE_ADVERTISE_IP as a candidate nobody can use, and into SFU_PUBLIC_HOST
 * where the client pinging it resolves it to its own machine rather than the
 * host's. Loopback fails the same way and looks even more reasonable.
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

/**
 * Interfaces whose addresses are never reachable from another machine.
 *
 * Windows names its virtual adapters for the product rather than the driver —
 * "VMware Network Adapter VMnet8", "VirtualBox Host-Only Network" — so the
 * `vmnet` and `vboxnet` entries, which are the Linux and macOS names, never
 * matched there. A host with VMware installed advertised its 192.168.x VMnet
 * address alongside the real one, and every client dutifully tried it.
 */
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
  // Filtered on the way out as well as on the way in, because a config written
  // before `validateCustomAddress` refused these still has them on disk, and
  // this runs on every load.
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
      : await findFreePortFrom(5000);
  const sfuPort = existingSfuPort() ?? (await findFreePortFrom(5005));
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
      // The port voice actually travels on, and the one that has to be opened
      // by hand. SFU_PORT above only carries signalling, over TCP; this is UDP
      // and it is separate, which is why a server can look completely healthy
      // — people join, chat works — and still have silent voice channels.
      //
      // It was not written here at all until GRYT-459, and the SFU is spawned
      // with an explicit environment rather than this file, so it never
      // reached the SFU either. What that meant in practice was a media port
      // nobody could name: pion picked ephemeral ports at random, so there was
      // nothing to forward and no way to find out.
      `ICE_UDP_MUX_PORT=${mediaPort}`,
      `EMBEDDED_SERVER_CUSTOM_ADDRESSES=`,
      `SFU_PUBLIC_HOST=${advertisedAddresses.map((address) => `${address}:${sfuPort}`).join(",") || `${lanIp}:${sfuPort}`}`,
      `ICE_ADVERTISE_IP=${advertisedAddresses.join(",")}`,
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
    // Configs written before GRYT-459 have no line for this. They report the
    // SFU's own default, which is what those servers are really using, so the
    // UI can name a port rather than shrug.
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
