/* eslint-env node */

/**
 * Validates electron-builder.yml against electron-builder's own schema. It
 * validates the whole object, so a Windows-only mistake fails all three builds.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const { load } = require("js-yaml");
const schema = require("app-builder-lib/scheme.json");

// electron-builder's own validator rather than a second opinion, so a config that
// passes here is one it accepts. Exported as the module itself, not by name.
const validate = require("@develar/schema-utils");

const config = load(readFileSync(join(here, "..", "electron-builder.yml"), "utf8"));

function check(candidate, label) {
  try {
    validate(schema, candidate, { name: "electron-builder" });
  } catch (err) {
    console.error(`${label} does not match electron-builder's schema:\n`);
    console.error(err.message);
    console.error(
      "\nThis is the validation electron-builder runs at package time. It checks " +
        "the whole config before looking at what is being built, so a mistake " +
        "under `win` fails the macOS and Linux builds too.",
    );
    process.exit(1);
  }
}

check(config, "electron-builder.yml");

// A release publishes two builds and only one is this file. The slim config is
// this YAML with three edits, and an edit can leave the schema too.
const configPath = join(here, "..", "electron-builder.config.cjs");

function loadVariant(variant, { mas = false } = {}) {
  const previous = process.env.GRYT_VARIANT;
  const previousMas = process.env.GRYT_MAS;
  if (variant === undefined) delete process.env.GRYT_VARIANT;
  else process.env.GRYT_VARIANT = variant;
  if (mas) process.env.GRYT_MAS = "1";
  else delete process.env.GRYT_MAS;

  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } finally {
    if (previous === undefined) delete process.env.GRYT_VARIANT;
    else process.env.GRYT_VARIANT = previous;
    if (previousMas === undefined) delete process.env.GRYT_MAS;
    else process.env.GRYT_MAS = previousMas;
  }
}

const slim = loadVariant("slim");
check(slim, "electron-builder.config.cjs at GRYT_VARIANT=slim");

const embeddedIn = (candidate) =>
  (candidate.extraResources ?? []).filter((entry) =>
    String(entry.from).startsWith("build/embedded-"),
  );

// The three things a slim build has to get right, each of which fails quietly: a
// build that looks slim, a channel that updates back, a name that overwrites.
const stillEmbedded = embeddedIn(slim);
if (stillEmbedded.length > 0) {
  console.error(
    "slim config still ships the embedded server:\n" +
      stillEmbedded.map((entry) => `  ${entry.from}`).join("\n"),
  );
  process.exit(1);
}

if (slim.publish?.channel !== "slim") {
  console.error(
    `slim config publishes to channel ${JSON.stringify(slim.publish?.channel)}, ` +
      "so a slim install would update itself onto the full build.",
  );
  process.exit(1);
}

if (!String(slim.artifactName).includes("slim")) {
  console.error(
    "slim artifacts are named like the full ones, so the two would overwrite " +
      "each other in the same release.",
  );
  process.exit(1);
}

// And the default is still the whole thing.
if (embeddedIn(loadVariant(undefined)).length === 0) {
  console.error("the default build has lost the embedded server.");
  process.exit(1);
}

// The Mac App Store build (GRYT-1273). The DMG must not pick up any of it.
function fail(message) {
  console.error(message);
  process.exit(1);
}

const dmg = loadVariant(undefined);
const masFull = loadVariant(undefined, { mas: true });
const masSlim = loadVariant("slim", { mas: true });
check(masFull, "electron-builder.config.cjs at GRYT_MAS=1");
check(masSlim, "electron-builder.config.cjs at GRYT_MAS=1 GRYT_VARIANT=slim");

if (dmg.appId !== "com.gryt.chat" || masFull.mas?.appId !== "chat.gryt.app") {
  fail("The DMG has to stay com.gryt.chat and the store build has to be chat.gryt.app.");
}

const dmgTargets = (dmg.mac?.target ?? []).map((t) => t.target).sort().join(",");
if (dmgTargets !== "dmg,zip" || "ITSAppUsesNonExemptEncryption" in (dmg.mac?.extendInfo ?? {})) {
  fail(`The DMG config changed shape: targets ${dmgTargets}, or it picked up the store's Info.plist keys.`);
}

for (const [label, candidate] of [["GRYT_MAS=1", masFull], ["GRYT_MAS=1 slim", masSlim]]) {
  const targets = (candidate.mac?.target ?? []).map((t) => t.target);
  if (targets.join(",") !== "mas") fail(`${label} builds ${targets.join(", ")}, not only mas.`);
  if (candidate.mac?.extendInfo?.ITSAppUsesNonExemptEncryption !== false) {
    fail(`${label} is missing ITSAppUsesNonExemptEncryption, so every upload asks about export compliance.`);
  }
  if (candidate.mac?.extendInfo?.ElectronTeamID !== "8883W2XTQ8") {
    fail(`${label} has no ElectronTeamID, so the app group is prefixed with whoever signed it.`);
  }
}

// Sandboxed apps can't run what they unpack, so the store build ships the runtime as a folder.
const masEmbedded = embeddedIn(masFull).map((entry) => entry.from);
if (masEmbedded.join(",") !== "build/embedded-server/") {
  fail(`GRYT_MAS=1 ships ${masEmbedded.join(", ") || "no runtime"} instead of build/embedded-server/ alone.`);
}
if (embeddedIn(masSlim).length > 0) fail("GRYT_MAS=1 slim still ships the embedded server.");

function entitlementKeys(name) {
  const plist = readFileSync(join(here, "..", "build", name), "utf8");
  return [...plist.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]).sort();
}

const inherit = entitlementKeys("entitlements.mas.inherit.plist");
if (inherit.join(",") !== "com.apple.security.app-sandbox,com.apple.security.inherit") {
  fail(`entitlements.mas.inherit.plist has ${inherit.join(", ")}. What inherits the sandbox gets those two and nothing else.`);
}

const app = entitlementKeys("entitlements.mas.plist");
for (const key of [
  "com.apple.security.app-sandbox",
  "com.apple.security.network.client",
  "com.apple.security.network.server",
  "com.apple.security.device.audio-input",
  "com.apple.security.device.camera",
]) {
  if (!app.includes(key)) fail(`entitlements.mas.plist is missing ${key}.`);
}

// The Linux icon set. electron-builder ships exactly what `linux.icon` points at,
// so a single PNG left the deb and the snap with a 1024x1024 (GRYT-1008).
const linuxIcon = loadVariant(undefined).linux?.icon;

if (linuxIcon !== "build/icons") {
  console.error(
    `linux.icon is ${JSON.stringify(linuxIcon)}, not the icon directory. ` +
      "Pointed at one file, that file is the only icon the deb and snap get.",
  );
  process.exit(1);
}

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

for (const size of ICON_SIZES) {
  const icon = join(here, "..", "build", "icons", `${size}x${size}.png`);
  if (!existsSync(icon)) {
    console.error(
      `build/icons/${size}x${size}.png is missing. Run \`yarn icons:generate\`; ` +
        "electron-builder reads the set by filename and skips what is not there.",
    );
    process.exit(1);
  }
}

// A 1024 in here is what flatpak refuses outright and what every desktop then
// downscales at runtime.
for (const name of readdirSync(join(here, "..", "build", "icons"))) {
  const size = Number(name.split("x")[0]);
  if (size > 512) {
    console.error(`build/icons/${name} is larger than 512x512, which some packagers refuse.`);
    process.exit(1);
  }
}

// The desktop entries as electron-builder writes them. The repeated MimeType never
// showed in the config, only in the built deb (GRYT-976).
const linuxTargets = loadVariant(undefined).linux?.target ?? [];
const work = mkdtempSync(join(tmpdir(), "gryt-desktop-entries-"));
const stubApp = join(work, "linux-unpacked");
mkdirSync(join(stubApp, "resources"), { recursive: true });
writeFileSync(join(stubApp, "gryt-chat"), "");

const entries = [];

try {
  const { build } = require("electron-builder");
  await build({
    projectDir: join(here, ".."),
    linux: linuxTargets,
    x64: true,
    publish: "never",
    // Nothing is packaged: the stub stands in for the app, and returning true
    // from the hook stops each target once its desktop entry is written.
    prepackaged: stubApp,
    config: { extends: "electron-builder.config.cjs", directories: { output: join(work, "out") } },
    effectiveOptionComputed: async (computed) => {
      if (Array.isArray(computed)) {
        const [args, desktopFile] = computed;
        const target = extname(args[args.indexOf("--package") + 1]).slice(1);
        entries.push({ target, text: readFileSync(desktopFile, "utf8") });
      } else if (computed?.desktopFile != null) {
        entries.push({ target: "snap", text: readFileSync(computed.desktopFile, "utf8") });
      } else if (computed?.desktop != null) {
        entries.push({ target: "AppImage", text: computed.desktop });
      }
      return true;
    },
  });
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (entries.length !== linuxTargets.length) {
  console.error(
    `Expected a desktop entry from each of ${linuxTargets.join(", ")} and got ${entries.length}, ` +
      "so the MimeType check below did not see all of them.",
  );
  process.exit(1);
}

for (const { target, text } of entries) {
  const mimeTypes = (/^MimeType=(.*)$/m.exec(text)?.[1] ?? "").split(";").filter(Boolean);
  const gryt = mimeTypes.filter((type) => type === "x-scheme-handler/gryt").length;

  if (gryt !== 1 || new Set(mimeTypes).size !== mimeTypes.length) {
    const found = mimeTypes.length > 0 ? `MimeType=${mimeTypes.join(";")}` : "no MimeType";
    console.error(
      `The ${target} desktop entry has ${found}. It should list x-scheme-handler/gryt once. ` +
        "That line is how an installed package gets gryt:// links, sign-in included. Repeats " +
        "come from setting linux.mimeTypes, which electron-builder adds to once per target.",
    );
    process.exit(1);
  }
}

console.log(`builder-config: ok, both variants and the store build, ${entries.length} Linux desktop entries`);
