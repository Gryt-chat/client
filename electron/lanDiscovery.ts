import { type ChildProcess, spawn } from "child_process";
import type { BrowserWindow } from "electron";

interface LanServer {
  name: string;
  host: string;
  port: number;
  version: string | null;
}

type CleanupFn = () => void;

/**
 * macOS: use the native `dns-sd` CLI which talks to the system mDNSResponder.
 * bonjour-service's UDP socket conflicts with mDNSResponder on port 5353,
 * so the native tool is the only reliable option on macOS.
 */
function startDnsSdBrowse(
  win: BrowserWindow,
  log: (msg: string) => void,
): CleanupFn {
  const procs: ChildProcess[] = [];
  const resolved = new Map<string, LanServer>();

  const browse = spawn("dns-sd", ["-B", "_gryt._tcp"], { stdio: "pipe" });
  procs.push(browse);

  let browseBuf = "";
  browse.stdout?.on("data", (chunk: Buffer) => {
    browseBuf += chunk.toString();
    const lines = browseBuf.split("\n");
    browseBuf = lines.pop() ?? "";

    for (const line of lines) {
      const match = line.match(
        /^\s*(Add|Rmv)\s+\d+\s+\d+\s+(\S+)\s+(\S+)\s+(.+?)\s*$/,
      );
      if (!match) continue;
      const [, action, , , instanceName] = match;

      if (action === "Add") {
        lookupService(instanceName.trim(), win, log, procs, resolved);
      } else if (action === "Rmv") {
        const name = instanceName.trim();
        const existing = [...resolved.entries()].find(
          ([, s]) => s.name === name,
        );
        if (existing) {
          const [key, server] = existing;
          resolved.delete(key);
          win.webContents.send("lan-server-removed", {
            host: server.host,
            port: server.port,
          });
        }
      }
    }
  });

  browse.on("error", (err) => log(`dns-sd browse error: ${err.message}`));

  return () => {
    for (const p of procs) {
      try {
        p.kill();
      } catch {
        /* best-effort */
      }
    }
  };
}

function lookupService(
  instanceName: string,
  win: BrowserWindow,
  log: (msg: string) => void,
  procs: ChildProcess[],
  resolved: Map<string, LanServer>,
): void {
  const lookup = spawn("dns-sd", ["-L", instanceName, "_gryt._tcp"], {
    stdio: "pipe",
  });
  procs.push(lookup);

  let buf = "";
  let host: string | null = null;
  let port: number | null = null;
  let version: string | null = null;

  lookup.stdout?.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const reachable = line.match(/can be reached at\s+(\S+?):(\d+)\s/);
      if (reachable) {
        host = reachable[1].replace(/\.$/, "");
        port = parseInt(reachable[2], 10);
      }
      const txtMatch = line.match(/version=(\S+)/);
      if (txtMatch) version = txtMatch[1];

      if (host && port !== null) {
        const key = `${host}:${port}`;
        if (!resolved.has(key)) {
          const server: LanServer = {
            name: instanceName,
            host,
            port,
            version,
          };
          resolved.set(key, server);
          win.webContents.send("lan-server-discovered", server);
          log(`mDNS: discovered "${instanceName}" at ${host}:${port}`);
        }
        lookup.kill();
      }
    }
  });

  lookup.on("error", (err) =>
    log(`dns-sd lookup error for "${instanceName}": ${err.message}`),
  );

  setTimeout(() => lookup.kill(), 10_000);
}

/**
 * Windows / Linux: use bonjour-service with periodic re-queries every 15s
 * to handle missed initial responses.
 */
async function startBonjourBrowse(
  win: BrowserWindow,
  log: (msg: string) => void,
): Promise<CleanupFn> {
  try {
    const { Bonjour } = await import("bonjour-service");
    const bonjour = new Bonjour();
    const browser = bonjour.find({ type: "gryt" });

    browser.on("up", (service) => {
      const host = service.host || service.referer?.address;
      if (!host) return;
      win.webContents.send("lan-server-discovered", {
        name: service.name,
        host,
        port: service.port,
        version: service.txt?.version ?? null,
      });
    });

    browser.on("down", (service) => {
      const host = service.host || service.referer?.address;
      if (!host) return;
      win.webContents.send("lan-server-removed", {
        host,
        port: service.port,
      });
    });

    const requery = setInterval(() => {
      try {
        browser.update();
      } catch {
        /* best-effort */
      }
    }, 15_000);

    return () => {
      clearInterval(requery);
      try {
        bonjour.destroy();
      } catch {
        /* best-effort */
      }
    };
  } catch (err) {
    log(`bonjour-service failed: ${err}`);
    return () => {};
  }
}

export function startLanDiscovery(
  win: BrowserWindow,
  log: (msg: string) => void,
): CleanupFn {
  let cleanup: CleanupFn = () => {};

  if (process.platform === "darwin") {
    log("mDNS: using native dns-sd (macOS)");
    cleanup = startDnsSdBrowse(win, log);
  } else {
    log("mDNS: using bonjour-service (with periodic re-query)");
    startBonjourBrowse(win, log).then((fn) => {
      cleanup = fn;
    });
  }

  return () => cleanup();
}
