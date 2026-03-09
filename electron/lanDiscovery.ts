import { type ChildProcess, spawn } from "child_process";
import { createSocket, type Socket as DgramSocket } from "dgram";
import type { BrowserWindow } from "electron";

interface LanServer {
  name: string;
  host: string;
  port: number;
  version: string | null;
}

type CleanupFn = () => void;

const MDNS_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;
const QUERY_INTERVAL_MS = 15_000;

// ── macOS: native dns-sd CLI ─────────────────────────────────────────

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
      try { p.kill(); } catch { /* best-effort */ }
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
            name: instanceName, host, port, version,
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

// ── Windows / Linux: raw dgram mDNS ─────────────────────────────────

/**
 * Build an mDNS PTR query packet for _gryt._tcp.local.
 *
 * Wire format (RFC 1035 + RFC 6762):
 *   Header: 12 bytes (ID=0, QR=0, QDCOUNT=1)
 *   Question: _gryt._tcp.local. IN PTR (QU bit set)
 */
function buildPtrQuery(): Buffer {
  const labels = ["_gryt", "_tcp", "local"];
  let nameLen = 1; // trailing 0x00
  for (const l of labels) nameLen += 1 + l.length;

  const buf = Buffer.alloc(12 + nameLen + 4);
  let off = 0;

  // Header: ID=0, flags=0, QDCOUNT=1
  buf.writeUInt16BE(0, off); off += 2;  // ID
  buf.writeUInt16BE(0, off); off += 2;  // Flags
  buf.writeUInt16BE(1, off); off += 2;  // QDCOUNT
  buf.writeUInt16BE(0, off); off += 2;  // ANCOUNT
  buf.writeUInt16BE(0, off); off += 2;  // NSCOUNT
  buf.writeUInt16BE(0, off); off += 2;  // ARCOUNT

  // QNAME
  for (const l of labels) {
    buf.writeUInt8(l.length, off++);
    buf.write(l, off, "ascii");
    off += l.length;
  }
  buf.writeUInt8(0, off++);

  // QTYPE=PTR(12), QCLASS=IN(1) with QU bit set (0x8001)
  buf.writeUInt16BE(12, off); off += 2;
  buf.writeUInt16BE(0x8001, off);

  return buf;
}

/**
 * Read a DNS name from a packet at the given offset, following compression
 * pointers (RFC 1035 §4.1.4).
 */
function readName(pkt: Buffer, startOff: number): { name: string; newOff: number } {
  const parts: string[] = [];
  let off = startOff;
  let jumped = false;
  let returnOff = 0;
  let safety = 0;

  while (off < pkt.length && safety++ < 128) {
    const len = pkt.readUInt8(off);
    if (len === 0) { off++; break; }

    if ((len & 0xc0) === 0xc0) {
      if (!jumped) returnOff = off + 2;
      off = pkt.readUInt16BE(off) & 0x3fff;
      jumped = true;
      continue;
    }

    off++;
    if (off + len > pkt.length) break;
    parts.push(pkt.subarray(off, off + len).toString("ascii"));
    off += len;
  }

  return { name: parts.join("."), newOff: jumped ? returnOff : off };
}

interface ParsedRecord {
  name: string;
  type: number;
  rdata: Buffer;
  rdataOff: number;
}

function parseRecords(pkt: Buffer): ParsedRecord[] {
  if (pkt.length < 12) return [];
  const qdcount = pkt.readUInt16BE(4);
  const ancount = pkt.readUInt16BE(6);
  const nscount = pkt.readUInt16BE(8);
  const arcount = pkt.readUInt16BE(10);
  let off = 12;

  // Skip questions
  for (let i = 0; i < qdcount && off < pkt.length; i++) {
    const { newOff } = readName(pkt, off);
    off = newOff + 4; // QTYPE + QCLASS
  }

  const records: ParsedRecord[] = [];
  const total = ancount + nscount + arcount;
  for (let i = 0; i < total && off < pkt.length; i++) {
    const { name, newOff } = readName(pkt, off);
    off = newOff;
    if (off + 10 > pkt.length) break;
    const type = pkt.readUInt16BE(off); off += 2;
    off += 2; // class
    off += 4; // TTL
    const rdlen = pkt.readUInt16BE(off); off += 2;
    const rdataOff = off;
    const rdata = pkt.subarray(off, off + rdlen);
    off += rdlen;
    records.push({ name, type, rdata, rdataOff });
  }
  return records;
}

const TYPE_PTR = 12;
const TYPE_SRV = 33;
const TYPE_TXT = 16;
const TYPE_A = 1;

function startDgramBrowse(
  win: BrowserWindow,
  log: (msg: string) => void,
): CleanupFn {
  const discovered = new Map<string, LanServer>();
  let sock: DgramSocket | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const query = buildPtrQuery();

  function sendQuery() {
    try {
      sock?.send(query, 0, query.length, MDNS_PORT, MDNS_ADDR);
    } catch {
      /* best-effort */
    }
  }

  try {
    sock = createSocket({ type: "udp4", reuseAddr: true });

    sock.on("error", (err) => {
      log(`mDNS socket error: ${err.message}`);
      try { sock?.close(); } catch { /* ignore */ }
      sock = null;
    });

    sock.bind(MDNS_PORT, () => {
      try {
        sock?.addMembership(MDNS_ADDR);
        sock?.setMulticastTTL(255);
        sock?.setMulticastLoopback(true);
      } catch (err) {
        log(`mDNS multicast setup error: ${err instanceof Error ? err.message : String(err)}`);
      }
      sendQuery();
      log("mDNS: dgram socket bound, first query sent");
    });

    sock.on("message", (msg, rinfo) => {
      try {
        handleMdnsResponse(msg, rinfo.address, win, log, discovered);
      } catch {
        /* malformed packet */
      }
    });

    timer = setInterval(sendQuery, QUERY_INTERVAL_MS);
  } catch (err) {
    log(`mDNS dgram setup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return () => {
    if (timer) clearInterval(timer);
    try { sock?.close(); } catch { /* best-effort */ }
    sock = null;
  };
}

/**
 * Parse an mDNS response and extract _gryt._tcp services.
 * A typical response contains PTR → SRV + TXT + A records.
 */
function handleMdnsResponse(
  pkt: Buffer,
  senderIp: string,
  win: BrowserWindow,
  log: (msg: string) => void,
  discovered: Map<string, LanServer>,
): void {
  const flags = pkt.readUInt16BE(2);
  if ((flags & 0x8000) === 0) return; // not a response

  const records = parseRecords(pkt);

  // Collect PTR answers pointing at _gryt._tcp.local
  const ptrNames: string[] = [];
  for (const r of records) {
    if (r.type === TYPE_PTR && r.name.toLowerCase() === "_gryt._tcp.local") {
      const { name } = readName(pkt, r.rdataOff);
      if (name) ptrNames.push(name);
    }
  }
  if (ptrNames.length === 0) return;

  // Build lookup maps for SRV, TXT, A
  const srvMap = new Map<string, { host: string; port: number }>();
  const txtMap = new Map<string, Record<string, string>>();
  const aMap = new Map<string, string>();

  for (const r of records) {
    const key = r.name.toLowerCase();
    if (r.type === TYPE_SRV && r.rdata.length >= 6) {
      const port = r.rdata.readUInt16BE(4);
      const { name: target } = readName(pkt, r.rdataOff + 6);
      srvMap.set(key, { host: target, port });
    }
    if (r.type === TYPE_TXT) {
      const kv: Record<string, string> = {};
      let toff = 0;
      while (toff < r.rdata.length) {
        const tlen = r.rdata.readUInt8(toff++);
        if (tlen === 0 || toff + tlen > r.rdata.length) break;
        const pair = r.rdata.subarray(toff, toff + tlen).toString("utf-8");
        toff += tlen;
        const eq = pair.indexOf("=");
        if (eq > 0) kv[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      txtMap.set(key, kv);
    }
    if (r.type === TYPE_A && r.rdata.length === 4) {
      aMap.set(key, `${r.rdata[0]}.${r.rdata[1]}.${r.rdata[2]}.${r.rdata[3]}`);
    }
  }

  for (const ptr of ptrNames) {
    const ptrLower = ptr.toLowerCase();
    const srv = srvMap.get(ptrLower);
    if (!srv) continue;

    const ip = aMap.get(srv.host.toLowerCase()) ?? senderIp;
    const txt = txtMap.get(ptrLower);
    const version = txt?.version ?? null;

    // Instance name: strip "._gryt._tcp.local" suffix
    const instanceName = ptr.replace(/\._gryt\._tcp\.local\.?$/i, "");
    const key = `${ip}:${srv.port}`;

    if (!discovered.has(key)) {
      const server: LanServer = {
        name: instanceName,
        host: ip,
        port: srv.port,
        version,
      };
      discovered.set(key, server);
      win.webContents.send("lan-server-discovered", server);
      log(`mDNS: discovered "${instanceName}" at ${ip}:${srv.port}`);
    }
  }
}

// ── Entry point ──────────────────────────────────────────────────────

export function startLanDiscovery(
  win: BrowserWindow,
  log: (msg: string) => void,
): CleanupFn {
  if (process.platform === "darwin") {
    log("mDNS: using native dns-sd (macOS)");
    return startDnsSdBrowse(win, log);
  }

  log("mDNS: using raw dgram mDNS (Windows/Linux)");
  return startDgramBrowse(win, log);
}
