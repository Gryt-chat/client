/* eslint-env node */

/**
 * The signature check that decides whether a Windows release is allowed out.
 *
 * `sign-windows.cjs` runs this over every artefact after the signing tool has
 * had its turn, and fails the build when a file came back unsigned. That is
 * the whole point of it: a cloud signing CLI that cannot find its credentials
 * tends to exit 0 having done nothing, and without this the release ships
 * unsigned and looks fine until somebody on Windows 11 is blocked by Smart App
 * Control.
 *
 * Headers are built here rather than read off a signed binary. A real one
 * would mean committing a several-megabyte fixture, or having a Windows
 * machine to hand, and the thing being tested is nine lines of offset
 * arithmetic against a layout that has not changed since the 1990s.
 *
 * The unsigned vector is not synthetic though. offset 0 / size 0 is what
 * Gryt-Chat-1.9.1-win-x64.exe reads today, checked against the published file
 * on 2026-09-02.
 */

import assert from "node:assert/strict";

import { parseCertificateTable } from "./windows-signature.mjs";

/**
 * A PE header with the certificate table set to whatever is asked for.
 *
 * @param {{ plus?: boolean, offset?: number, size?: number }} opts
 */
function header({ plus = false, offset = 0, size = 0 } = {}) {
  const buf = Buffer.alloc(1024);
  const peOffset = 0x80;

  buf.write("MZ", 0, "latin1");
  buf.writeUInt32LE(peOffset, 0x3c);
  buf.write("PE\0\0", peOffset, "latin1");

  const optional = peOffset + 24;
  buf.writeUInt16LE(plus ? 0x20b : 0x10b, optional);

  const dataDirectory = optional + (plus ? 112 : 96);
  const entry = dataDirectory + 4 * 8;
  buf.writeUInt32LE(offset, entry);
  buf.writeUInt32LE(size, entry + 4);

  return buf;
}

// The case that matters, and the one that is real. This is what the shipped
// v1.9.1 installer looks like.
assert.deepEqual(parseCertificateTable(header()), { signed: false, offset: 0, size: 0 });

// A signed file, both header layouts. electron-builder emits PE32 for the
// x64 installer today, so the PE32+ case is there to stop the arithmetic
// rotting if that ever changes.
assert.equal(parseCertificateTable(header({ offset: 0x1000, size: 0x2000 })).signed, true);
assert.equal(parseCertificateTable(header({ plus: true, offset: 0x1000, size: 0x2000 })).signed, true);

// Half a table is not a signature. Either of these alone means something is
// wrong with the file, and reading it as signed would be the one mistake this
// check exists to prevent.
assert.equal(parseCertificateTable(header({ offset: 0x1000, size: 0 })).signed, false);
assert.equal(parseCertificateTable(header({ offset: 0, size: 0x2000 })).signed, false);

// Anything that is not a PE file throws rather than answering. A signing step
// pointed at the wrong path must not quietly report success.
assert.throws(() => parseCertificateTable(Buffer.alloc(1024)), /no MZ signature/);
assert.throws(() => parseCertificateTable(Buffer.alloc(8)), /no MZ signature/);

{
  const bad = header();
  bad.write("XX\0\0", 0x80, "latin1");
  assert.throws(() => parseCertificateTable(bad), /no PE signature/);
}

{
  const bad = header();
  bad.writeUInt16LE(0x0bad, 0x80 + 24);
  assert.throws(() => parseCertificateTable(bad), /unrecognised optional header magic/);
}

console.log("windows-signature: ok");

// --- the hook's behaviour, which is the part that protects a release ---

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const signWindows = require("./sign-windows.cjs");
const SIGNABLE_IN_HOOK = signWindows.SIGNABLE;

const dir = mkdtempSync(join(tmpdir(), "gryt-sign-"));
const unsigned = join(dir, "Gryt.exe");
writeFileSync(unsigned, header());

// Nothing configured: the artefact stays unsigned and the build carries on,
// which is exactly what happens today. Failing here would break every release
// until a certificate exists.
delete process.env.GRYT_WIN_SIGN_TOOL;
await signWindows({ path: unsigned });

// A signing tool that exits 0 and signs nothing. This is the failure the whole
// file exists for, and the one an exit code alone would wave through.
process.env.GRYT_WIN_SIGN_TOOL = "true";
process.env.GRYT_WIN_SIGN_ARGS = '["{file}"]';
await assert.rejects(
  () => signWindows({ path: unsigned }),
  /exited 0 but .* has no certificate table/,
);

// A tool that fails is reported as a tool that failed, rather than as a
// missing signature, so the log points at the real cause.
process.env.GRYT_WIN_SIGN_TOOL = "false";
await assert.rejects(() => signWindows({ path: unsigned }), /exited 1/);

// A tool that is not installed at all.
process.env.GRYT_WIN_SIGN_TOOL = "gryt-no-such-signing-tool";
await assert.rejects(() => signWindows({ path: unsigned }), /could not run/);

// A .node that is not a Windows binary. This is what broke the v1.9.4 release:
// `uiohook-napi` ships prebuilds for every platform, so a Windows build carries
// `prebuilds/linux-x64/node.napi.node` next to the one it loads. `signExts`
// matches on extension, the ELF reached the reader, and "Not a PE file: no MZ
// signature" took the release down after three retries.
//
// Skipped, not signed and not fatal: it is not a Windows binary, so Smart App
// Control will never look at it and there is nothing to sign.
//
// No signing tool configured, which is the state every release has been in so
// far — so a regression walks the same path the release did and throws the
// same "no MZ signature" here instead of an hour into a build.
const elfNode = join(dir, "node.napi.node");
writeFileSync(elfNode, Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...Array(60).fill(0)]));
delete process.env.GRYT_WIN_SIGN_TOOL;
await signWindows({ path: elfNode });

// The Windows one in the same folder still goes through, so the skip above is
// about the bytes rather than about the extension.
const peNode = join(dir, "win.napi.node");
writeFileSync(peNode, header());
delete process.env.GRYT_WIN_SIGN_TOOL;
await signWindows({ path: peNode });

// Files that are not code are left alone. Handing a .yml to a signing tool is
// how a build breaks for a reason nobody enjoys finding.
const notCode = join(dir, "latest.yml");
writeFileSync(notCode, "version: 1.9.1\n");
process.env.GRYT_WIN_SIGN_TOOL = "false";
await signWindows({ path: notCode });

delete process.env.GRYT_WIN_SIGN_TOOL;
delete process.env.GRYT_WIN_SIGN_ARGS;

// --- the config and the hook have to agree about what a PE file is ---

// Store policy 10.2.9 wants every PE file signed, not just the installer.
// electron-builder decides which files to hand the hook from `signExts`, and
// the hook decides which of those to actually sign. If those two lists drift,
// something ships unsigned inside a signed installer and the only symptom is a
// failed Store review weeks later. So they are compared here.
{
  const yaml = require("js-yaml");
  const { readFileSync } = await import("node:fs");
  const config = yaml.load(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8"));
  // On `win`, not on `win.signtoolOptions`. This check asserted the nested path
  // when it was written, which is why it passed while the config was wrong: a
  // check built from the same misunderstanding as the code confirms the
  // misunderstanding. check-builder-config.mjs is the answer to that, because
  // the schema it validates against comes from electron-builder rather than
  // from whoever wrote this.
  const signExts = config?.win?.signExts;

  assert.ok(Array.isArray(signExts), "win.signExts must be set");

  // Without these, electron-builder falls back to signing only .exe and
  // Electron's own DLLs and every native .node go out unsigned.
  for (const ext of [".exe", ".dll", ".node"]) {
    assert.ok(signExts.includes(ext), `signExts is missing ${ext}`);
  }

  // Everything electron-builder is told to hand over must be something the
  // hook will actually sign, or it silently passes through.
  for (const ext of signExts) {
    assert.ok(
      SIGNABLE_IN_HOOK.test(`file${ext}`),
      `sign-windows.cjs would skip ${ext}, which signExts asks for`,
    );
  }
}

// --- the MSIX package, which is a zip and not a PE file ---

/**
 * A zip holding one stored, empty member, built by hand.
 *
 * `hasAppxSignature` only ever reads the central directory, so the members
 * themselves can be empty and the CRCs can be zero. What it has to get right
 * is the record layout, which is the part a real zip library would hide.
 */
function zipWith(name) {
  const nameBytes = Buffer.from(name, "latin1");

  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(nameBytes.length, 28);
  nameBytes.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);

  return Buffer.concat([local, central, eocd]);
}

const { hasAppxSignature } = await import("./windows-signature.mjs");

const signedPackage = join(dir, "signed.appx");
writeFileSync(signedPackage, zipWith("AppxSignature.p7x"));
assert.equal(await hasAppxSignature(signedPackage), true);

const unsignedPackage = join(dir, "unsigned.appx");
writeFileSync(unsignedPackage, zipWith("AppxManifest.xml"));
assert.equal(await hasAppxSignature(unsignedPackage), false);

// The reason the central directory is walked rather than searched. A member of
// the payload with that name is a file the app happens to ship, not a package
// signature, and a substring search over the bytes cannot tell the two apart.
const decoyPackage = join(dir, "decoy.appx");
writeFileSync(decoyPackage, zipWith(String.raw`app\AppxSignature.p7x`));
assert.equal(await hasAppxSignature(decoyPackage), false);

// The hook has to route .appx away from the PE reader. Before it did, the
// package fell through the extension test and the hook returned silently —
// electron-builder said "signing with signtool.exe" and nothing was signed or
// reported.
delete process.env.GRYT_WIN_SIGN_TOOL;
await signWindows({ path: unsignedPackage });
await signWindows({ path: signedPackage });

// A tool that exits 0 having signed nothing fails the build here too. This is
// the one that matters most: an unsigned .appx does not install at all.
process.env.GRYT_WIN_SIGN_TOOL = "true";
process.env.GRYT_WIN_SIGN_ARGS = '["{file}"]';
await assert.rejects(
  () => signWindows({ path: unsignedPackage }),
  /exited 0 but .* has no AppxSignature\.p7x/,
);

delete process.env.GRYT_WIN_SIGN_TOOL;
delete process.env.GRYT_WIN_SIGN_ARGS;

// appx is a target in electron-builder.yml, so the hook must claim it. If the
// target were dropped this assertion is the thing that says the hook branch is
// now dead code.
{
  const yaml = require("js-yaml");
  const { readFileSync } = await import("node:fs");
  const config = yaml.load(readFileSync(new URL("../electron-builder.yml", import.meta.url), "utf8"));
  const targets = config?.win?.target ?? [];

  if (targets.includes("appx")) {
    assert.ok(
      signWindows.PACKAGE.test("Gryt-Chat-1.0.0-win-x64.appx"),
      "win.target builds appx but sign-windows.cjs would not sign it",
    );
  }
}

console.log("sign-windows: ok");
