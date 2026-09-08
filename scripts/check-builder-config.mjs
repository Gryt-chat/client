/* eslint-env node */

/**
 * Validates electron-builder.yml against electron-builder's own schema. It
 * validates the whole object, so a Windows-only mistake fails all three builds.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

function loadVariant(variant) {
  const previous = process.env.GRYT_VARIANT;
  if (variant === undefined) delete process.env.GRYT_VARIANT;
  else process.env.GRYT_VARIANT = variant;

  try {
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } finally {
    if (previous === undefined) delete process.env.GRYT_VARIANT;
    else process.env.GRYT_VARIANT = previous;
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

console.log("builder-config: ok, both variants");
