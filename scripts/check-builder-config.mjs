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

try {
  validate(schema, config, { name: "electron-builder" });
} catch (err) {
  console.error("electron-builder.yml does not match electron-builder's schema:\n");
  console.error(err.message);
  console.error(
    "\nThis is the validation electron-builder runs at package time. It checks " +
      "the whole config before looking at what is being built, so a mistake " +
      "under `win` fails the macOS and Linux builds too.",
  );
  process.exit(1);
}

console.log("builder-config: ok");
