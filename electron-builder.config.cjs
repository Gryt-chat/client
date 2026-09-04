// Note: CommonJS because electron-builder loads a JS config through require().

const fs = require("node:fs");
const path = require("node:path");

const yaml = require("js-yaml");

/**
 * electron-builder.yml, plus the handful of things a slim build changes.
 *
 * The YAML stays the source of truth and carries all the commentary; this file
 * exists only because YAML cannot branch, and a slim build has to differ in
 * three ways that a missing file cannot express on its own:
 *
 *   - the embedded server's extraResources come out
 *   - the artifacts need different names, or the two variants overwrite each
 *     other in the same GitHub release
 *   - the update feed needs its own channel, or a slim install downloads the
 *     full build on the next release and silently puts 34MB back
 *
 * `GRYT_VARIANT=slim` rather than a CLI flag, because the same value has to
 * reach the beforeBuild hook and the resource check, and neither of those is
 * passed electron-builder's arguments. See scripts/variant.mjs — this repeats
 * its one-line check because that file is ESM.
 */
const SLIM = process.env.GRYT_VARIANT === "slim";

/** Kept in step with EMBEDDED_RESOURCE_PREFIX in scripts/variant.mjs. */
const EMBEDDED_RESOURCE_PREFIX = "build/embedded-";

const config = yaml.load(
  fs.readFileSync(path.join(__dirname, "electron-builder.yml"), "utf8"),
);

if (SLIM) {
  config.extraResources = config.extraResources.filter(
    (entry) => !String(entry.from).startsWith(EMBEDDED_RESOURCE_PREFIX),
  );

  // ${} is electron-builder's own macro syntax, expanded when the artifact is
  // named. Not a template literal.
  config.artifactName = "Gryt-Chat-${version}-${os}-${arch}-slim.${ext}";
  config.portable = {
    ...config.portable,
    artifactName: "Gryt-Chat-${version}-${os}-${arch}-slim-portable.${ext}",
  };

  // Produces slim.yml, slim-mac.yml and slim-linux.yml next to the latest*.yml
  // the full build publishes. electron/main.ts asks for the matching one.
  config.publish = { ...config.publish, channel: "slim" };
}

module.exports = config;
