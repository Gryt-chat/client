import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** One way of reaching a server. The tunnel and direct groups are the same server by two paths. */
export interface Group {
  name: string;
  /** As the app stores it, e.g. `test.gryt.chat` or `192.168.50.147:5030`. */
  host: string;
  httpBase: string;
  /** The invite code, or null for a server anyone can join. */
  invite: string | null;
  /** The SFU's signalling address on this path, for the probes. */
  sfu: string | null;
  /** WebSocket URL prefixes the page swaps, so the direct group's calls skip the tunnel too. */
  rewrite: [string, string][];
  /** Keep this machine's ICE candidates from the SFU, so media takes the SFU's public address. */
  hideLocal: boolean;
  /** Call clients: a Chromium each, in the voice channel. Zero leaves only the probes. */
  clients: number;
}

export interface SoakConfig {
  groups: Group[];
  minutes: number;
  out: string;
  camera: boolean;
  ping: string[];
  browserProbe: boolean;
}

const env = process.env;
const count = (value: string | undefined, fallback: number) => (value === undefined || value === "" ? fallback : Number(value));

function group(name: string, url: string, invite: string | null, sfu: string | null, clients: number): Group {
  const { host, origin } = new URL(url);
  return { name, host, httpBase: origin, invite, sfu: sfu || null, rewrite: [], hideLocal: false, clients };
}

export function readConfig(): SoakConfig {
  const groups: Group[] = [];
  const invite = env.GRYT_TEST_INVITE_CODE || null;
  const tunnelSfu = env.GRYT_SOAK_TUNNEL_SFU || null;

  if (env.GRYT_TEST_SERVER_URL) {
    const tunnel = group("tunnel", env.GRYT_TEST_SERVER_URL, invite, tunnelSfu, invite ? count(env.GRYT_SOAK_CLIENTS, 3) : 0);
    tunnel.hideLocal = env.GRYT_E2E_SEND_LOCAL_CANDIDATES !== "1";
    groups.push(tunnel);
  }
  if (env.GRYT_SOAK_DIRECT_SERVER) {
    const directSfu = env.GRYT_SOAK_DIRECT_SFU || null;
    const direct = group("direct", env.GRYT_SOAK_DIRECT_SERVER, invite, directSfu, invite ? count(env.GRYT_SOAK_DIRECT_CLIENTS, 2) : 0);
    // The server hands every client its public SFU address, so the direct group swaps it for the LAN one.
    if (tunnelSfu && directSfu) direct.rewrite = [[tunnelSfu.replace(/\/$/, ""), directSfu.replace(/\/$/, "")]];
    groups.push(direct);
  }
  if (env.GRYT_SOAK_LOCAL_SERVER) {
    const localInvite = env.GRYT_SOAK_LOCAL_INVITE || null;
    groups.push(group("local", env.GRYT_SOAK_LOCAL_SERVER, localInvite, env.GRYT_SOAK_LOCAL_SFU || null, count(env.GRYT_SOAK_LOCAL_CLIENTS, 2)));
  }
  if (groups.length === 0) {
    throw new Error("Nothing to soak. Set GRYT_TEST_SERVER_URL, GRYT_SOAK_DIRECT_SERVER or GRYT_SOAK_LOCAL_SERVER; e2e/README.md has the rest.");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runs = fileURLToPath(new URL("./runs", new URL("..", import.meta.url)));
  return {
    groups,
    minutes: count(env.GRYT_SOAK_MINUTES, 240),
    out: env.GRYT_SOAK_OUT || join(runs, `${stamp}Z`),
    camera: env.GRYT_SOAK_CAMERA !== "0",
    ping: (env.GRYT_SOAK_PING ?? "").split(",").map((h) => h.trim()).filter(Boolean),
    browserProbe: env.GRYT_SOAK_BROWSER_PROBE !== "0",
  };
}
