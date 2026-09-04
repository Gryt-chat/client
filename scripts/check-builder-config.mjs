/* eslint-env node */

/**
 * Validates electron-builder.yml against electron-builder's own schema.
 *
 * This exists because of a specific mistake. `signExts` was written under
 * `win.signtoolOptions`, where it is not a valid property — it belongs on `win`
 * itself, next to `target` and `icon`. Nothing local caught it. lint does not
 * read this file, the checks do not read this file, and the only thing that
 * validates it is electron-builder at package time, which only runs during a
 * release.
 *
 * The part that made it expensive: electron-builder validates the *whole*
 * configuration object before it looks at what it is building. So a Windows-only
 * mistake failed the macOS and Linux builds as well, and the first release after
 * it merged died on all three platforms at once.
 *
 * The schema ships inside app-builder-lib, so this is the same check
 * electron-builder makes, run in a second instead of twenty minutes into a
 * release.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const { load } = require("js-yaml");
const schema = require("app-builder-lib/scheme.json");

// electron-builder's own validator rather than a second opinion. The stack
// trace from the failed release ends in exactly this function, so a config that
// passes here is a config electron-builder accepts, and the wording of a
// failure is the wording a release would have shown.
// Exported as the module itself rather than as a named export.
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

// A release publishes two builds and only one of them is this file. The slim
// config is the YAML with three edits applied, and an edit that leaves the
// schema costs exactly as much there as it does here.
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

// The three things a slim build has to get right, asserted rather than assumed.
// Each of them fails quietly: the wrong filter produces a build that looks slim
// and is not, the wrong channel updates people back onto the full build, and
// the wrong name has the two variants overwrite each other in one release.
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

console.log("builder-config: ok, both variants");
