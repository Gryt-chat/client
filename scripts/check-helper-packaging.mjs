#!/usr/bin/env node
/**
 * gryt-helper in the release builds (GRYT-1605): built for each arch, shipped under
 * resources/helper, signed with everything else, and left out of the Mac App Store build.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { load } = require("js-yaml");

let failures = 0;
function check(name, run) {
  try {
    run();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL  ${name}\n        ${err.stack ?? err.message}`);
  }
}

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const yml = load(read("electron-builder.yml"));

function configFor(env) {
  const out = execFileSync(process.execPath, ["-e", "console.log(JSON.stringify(require('./electron-builder.config.cjs')))"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, GRYT_MAS: "", GRYT_VARIANT: "", ...env },
  });
  return JSON.parse(out.toString());
}

check("every desktop build carries the helper for its own arch", () => {
  const entry = yml.extraResources.find((e) => e.from === "build/helper/${arch}/");
  assert.ok(entry, "no helper in extraResources");
  assert.equal(entry.to, "helper/");
  for (const variant of ["", "slim"]) {
    assert.ok(configFor({ GRYT_VARIANT: variant }).extraResources.some((e) => e.from === "build/helper/${arch}/"), `variant ${variant || "full"}`);
  }
});

check("the beforeBuild hook builds it for the arch it's called with, and fails loudly", () => {
  const hook = read("scripts/prepare-electron-build.mjs");
  assert.match(hook, /export default async function beforeBuild\(context\)/);
  assert.match(hook, /buildHelper\(\{ platform, arch, out:/);
  assert.match(hook, /const arch = context\?\.arch/);
  assert.doesNotMatch(hook, /buildHelper[\s\S]{0,200}catch/, "a failed Go build must stop the release");
});

check("SMAppService finds the agent, and it points at the helper in this bundle", () => {
  const extra = yml.mac.extraFiles.find((e) => e.from === "build/chat.gryt.helper.plist");
  assert.equal(extra?.to, "Library/LaunchAgents/chat.gryt.helper.plist");
  const plist = read("build/chat.gryt.helper.plist");
  assert.match(plist, /<key>BundleProgram<\/key>\s*<string>Contents\/Resources\/helper\/gryt-helper<\/string>/);
  assert.match(plist, new RegExp(`<key>AssociatedBundleIdentifiers</key>\\s*<array>\\s*<string>${yml.appId.replace(/\./g, "\\.")}</string>`));
  assert.match(plist, /<key>Label<\/key>\s*<string>chat\.gryt\.helper<\/string>/);
  assert.doesNotMatch(plist, /KeepAlive/, "quit and the switch must be able to stop it");
});

check("the Mac App Store build leaves both out", () => {
  const mas = configFor({ GRYT_MAS: "1" });
  assert.equal(mas.extraResources.some((e) => String(e.from).startsWith("build/helper/")), false);
  assert.deepEqual(mas.mac.extraFiles, []);
  assert.match(read("scripts/prepare-electron-build.mjs"), /if \(!isMasBuild\(\)\) \{\s*const platform/);
});

check("Windows signs it with the rest: .exe is in signExts, through sign-windows.cjs", () => {
  assert.ok(yml.win.signExts.includes(".exe"));
  assert.equal(yml.win.signtoolOptions.sign, "scripts/sign-windows.cjs");
});

console.log(failures === 0 ? "\nhelper packaging: ok" : `\nhelper packaging: ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
