import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SERVER_IMAGE =
  process.env.GRYT_E2E_SERVER_IMAGE || "ghcr.io/gryt-chat/server:latest";

/** Marks every container a run starts, so its teardown can find them all. */
export const RUN_LABEL = "chat.gryt.e2e-run";

export interface GrytServer {
  /** What a person types into Add a server, e.g. `127.0.0.1:32768`. */
  host: string;
  httpBase: string;
  /** Null when the suite was pointed at a server somebody else started. */
  containerId: string | null;
  logs(): Promise<string>;
  stop(): Promise<void>;
}

async function docker(args: string[]): Promise<string> {
  const { stdout } = await run("docker", args, { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

export async function ensureImage(): Promise<void> {
  try {
    await docker(["image", "inspect", SERVER_IMAGE, "--format", "{{.Id}}"]);
  } catch {
    await docker(["pull", "--quiet", SERVER_IMAGE]);
  }
}

async function hostPort(containerId: string, containerPort: number): Promise<number> {
  const out = await docker(["port", containerId, `${containerPort}/tcp`]);
  const match = /:(\d+)\s*$/m.exec(out.split("\n")[0] ?? "");
  if (!match) throw new Error(`docker port gave no host port for ${containerPort}: ${out}`);
  return Number(match[1]);
}

async function waitForHealth(httpBase: string, containerId: string | null): Promise<void> {
  const deadline = Date.now() + 60_000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${httpBase}/health`);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const tail = containerId ? await docker(["logs", "--tail", "50", containerId]).catch(() => "") : "";
  throw new Error(`Gryt server at ${httpBase} never answered /health (${last})\n${tail}`);
}

async function openJoin(adminBase: string, token: string): Promise<void> {
  const res = await fetch(`${adminBase}/management/settings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ joinPolicy: "open", displayName: "Gryt E2E" }),
  });
  if (!res.ok) throw new Error(`Opening the server to joins failed: HTTP ${res.status} ${await res.text()}`);
}

/** A fresh server in its own container: guest identities, open join, files on its own disk. */
export async function startServer(appOrigin: string, runId: string): Promise<GrytServer> {
  const adminToken = randomBytes(24).toString("hex");
  const env = {
    PORT: "5000",
    HOST: "0.0.0.0",
    SERVER_NAME: "Gryt E2E",
    GRYT_IDENTITY_TIERS: "local",
    CORS_ORIGIN: appOrigin,
    DATA_DIR: "/data",
    STORAGE_BACKEND: "filesystem",
    S3_BUCKET: "gryt",
    JWT_SECRET: randomBytes(32).toString("hex"),
    METRICS_PORT: "0",
    GRYT_ADMIN_TOKEN: adminToken,
    GRYT_ADMIN_PORT: "5099",
  };

  const args = ["run", "--detach", "--label", `${RUN_LABEL}=${runId}`];
  args.push("--publish", "127.0.0.1::5000", "--publish", "127.0.0.1::5099");
  for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
  const containerId = await docker([...args, SERVER_IMAGE]);

  const stop = async () => {
    await docker(["rm", "--force", "--volumes", containerId]).catch(() => undefined);
  };

  try {
    const port = await hostPort(containerId, 5000);
    const adminPort = await hostPort(containerId, 5099);
    const httpBase = `http://127.0.0.1:${port}`;
    await waitForHealth(httpBase, containerId);
    await openJoin(`http://127.0.0.1:${adminPort}`, adminToken);

    return {
      host: `127.0.0.1:${port}`,
      httpBase,
      containerId,
      logs: () => docker(["logs", containerId]).catch((err) => String(err)),
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}

/** GRYT_E2E_SERVER, for a server started by hand. It has to be fresh: the first guest owns it. */
export async function externalServer(host: string): Promise<GrytServer> {
  const httpBase = `http://${host}`;
  await waitForHealth(httpBase, null);

  const adminBase = process.env.GRYT_E2E_ADMIN_URL;
  const adminToken = process.env.GRYT_E2E_ADMIN_TOKEN;
  if (adminBase && adminToken) await openJoin(adminBase, adminToken);

  const info = (await (await fetch(`${httpBase}/info`)).json()) as {
    joinPolicy?: string;
    identityTiers?: string[];
  };
  if (!info.identityTiers?.includes("local")) {
    throw new Error(`${host} does not take guests. Start it with GRYT_IDENTITY_TIERS=local.`);
  }
  if (info.joinPolicy !== "open") {
    throw new Error(
      `${host} is not open to joins. Set GRYT_E2E_ADMIN_URL and GRYT_E2E_ADMIN_TOKEN, or open it yourself.`,
    );
  }

  return {
    host,
    httpBase,
    containerId: null,
    logs: async () => "",
    stop: async () => undefined,
  };
}

/** For exit paths where nothing async runs any more. */
export function removeRunContainersSync(runId: string): void {
  try {
    const ids = execFileSync("docker", ["ps", "-aq", "--filter", `label=${RUN_LABEL}=${runId}`])
      .toString()
      .split("\n")
      .filter(Boolean);
    if (ids.length) execFileSync("docker", ["rm", "--force", "--volumes", ...ids], { stdio: "ignore" });
  } catch {
    // Docker gone or never there; nothing left to clean.
  }
}
