/* eslint-env node */

/**
 * How the desktop app finds servers on the network. The Mac App Store build can't use dns-sd,
 * and on macOS a unicast mDNS reply never reaches the app's own socket (GRYT-1273).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildPtrQuery, handleMdnsResponse } from "../electron/lanDiscovery.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const source = readFileSync(`${ROOT}/electron/lanDiscovery.ts`, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

/** The last question's class. The top bit asks for a unicast reply (RFC 6762, 5.4). */
const questionClass = (query) => query.readUInt16BE(query.length - 2);

console.log("lan discovery");

check("the query asks for _gryt._tcp.local PTR records", () => {
  const query = buildPtrQuery(false);
  assert.equal(query.readUInt16BE(4), 1, "one question");
  assert.ok(query.includes(Buffer.from("\x05_gryt\x04_tcp\x05local\x00", "latin1")), "not _gryt._tcp.local");
  assert.equal(query.readUInt16BE(query.length - 4), 12, "not a PTR question");
});

check("Windows and Linux still ask for a unicast reply, over IPv4 only", () => {
  assert.equal(questionClass(buildPtrQuery(true)), 0x8001);
  assert.ok(source.includes('log("mDNS: using raw dgram mDNS (Windows/Linux)");\n    return startDgramBrowse(win, log);'), "Windows and Linux browse differently");
});

check("the store build asks for a multicast reply", () => {
  assert.equal(questionClass(buildPtrQuery(false)), 0x0001);
  assert.ok(source.includes("const query = buildPtrQuery(!process.mas);"), "the reply type no longer follows process.mas");
});

/* ── Answers ──────────────────────────────────────────────────────── */

function name(labels) {
  return Buffer.concat([...labels.map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
}

function record(labels, type, rdata) {
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(1, 2);
  fixed.writeUInt32BE(120, 4);
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([name(labels), fixed, rdata]);
}

/** One server's answer: PTR, SRV to dev.local, TXT, and either an A or an AAAA record. */
function answer({ ipv4 }) {
  const instance = ["Gryt", "_gryt", "_tcp", "local"];
  const srv = Buffer.alloc(6);
  srv.writeUInt16BE(5000, 4);
  const txt = Buffer.concat(["version=1.10.15", "server_id=default"].map((kv) => Buffer.concat([Buffer.from([kv.length]), Buffer.from(kv)])));
  const records = [
    record(["_gryt", "_tcp", "local"], 12, name(instance)),
    record(instance, 33, Buffer.concat([srv, name(["dev", "local"])])),
    record(instance, 16, txt),
    ipv4 ? record(["dev", "local"], 1, Buffer.from([192, 168, 50, 10])) : record(["dev", "local"], 28, Buffer.alloc(16, 1)),
  ];
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(1, 6);
  header.writeUInt16BE(records.length - 1, 10);
  return Buffer.concat([header, ...records]);
}

function discover(pkt, senderIp) {
  const sent = [];
  const win = { webContents: { send: (channel, server) => sent.push({ channel, server }) } };
  handleMdnsResponse(pkt, senderIp, win, () => undefined, new Map(), new Map());
  return sent;
}

check("an IPv4 answer gives the A record's address", () => {
  const [event] = discover(answer({ ipv4: true }), "192.168.50.10");
  assert.equal(event?.channel, "lan-server-discovered");
  assert.deepEqual(
    { name: event.server.name, host: event.server.host, port: event.server.port, version: event.server.version },
    { name: "Gryt", host: "192.168.50.10", port: 5000, version: "1.10.15" },
  );
});

check("an IPv6 answer has no A record, so the host is the SRV target, as dns-sd gives it", () => {
  const [event] = discover(answer({ ipv4: false }), null);
  assert.equal(event?.server.host, "dev.local");
  assert.equal(event?.server.port, 5000);
});

check("the store build browses over IPv4 and IPv6 with one set of results", () => {
  assert.match(
    source,
    /startDgramBrowse\(win, log, "udp4", discovered, discoveredByName\),\s*startDgramBrowse\(win, log, "udp6", discovered, discoveredByName\),/,
    "the store build no longer asks over both, or keeps two sets of results",
  );
  assert.ok(source.includes('family === "udp6" ? null : rinfo.address'), "an IPv6 answer would give the sender's address");
});

check("only the store build leaves dns-sd on macOS", () => {
  assert.match(
    source,
    /if \(process\.platform === "darwin" && !process\.mas\) \{\s*log\("mDNS: using native dns-sd \(macOS\)"\);\s*return startDnsSdBrowse\(win, log\);/,
    "a Mac build outside the store no longer uses dns-sd, or the store build does",
  );
});

console.log(failures === 0 ? "\nlan discovery: ok" : `\nlan discovery: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
