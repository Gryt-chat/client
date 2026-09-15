import { execFile } from "node:child_process";
import { createServer, type Server } from "node:net";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Listener {
  pid: number;
  /** The local address as lsof prints it, e.g. `127.0.0.1:9093` or `*:3478`. */
  address: string;
}

/** Every process with a socket bound to this local port: listening for TCP, bound at all for UDP. */
export async function listeners(port: number, protocol: "TCP" | "UDP"): Promise<Listener[]> {
  const state = protocol === "TCP" ? ["-sTCP:LISTEN"] : [];
  // lsof exits 1 when nothing matches, and on some errors after printing what it did find.
  const { stdout } = await run("lsof", ["-nP", `-i${protocol}:${port}`, ...state, "-Fpn"]).catch(
    (err: { stdout?: string }) => ({ stdout: err.stdout ?? "" }),
  );

  const found: Listener[] = [];
  let pid = 0;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (!line.startsWith("n")) continue;
    const local = line.slice(1).split("->")[0];
    if (local.endsWith(`:${port}`)) found.push({ pid, address: local });
  }
  return found;
}

export async function isDescendantOf(pid: number, ancestor: number): Promise<boolean> {
  let current = pid;
  for (let hops = 0; current > 1 && hops < 16; hops++) {
    if (current === ancestor) return true;
    const { stdout } = await run("ps", ["-o", "ppid=", "-p", String(current)]).catch(() => ({ stdout: "" }));
    current = Number(stdout.trim());
  }
  return false;
}

export async function isAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Takes each free port on loopback, the way another app's SFU would. A port somebody already holds is taken anyway. */
export async function occupy(ports: number[]): Promise<{ release: () => Promise<void> }> {
  const servers: Server[] = [];
  for (const port of ports) {
    const server = createServer();
    const bound = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (bound) servers.push(server);
  }
  return {
    release: async () => {
      await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    },
  };
}
