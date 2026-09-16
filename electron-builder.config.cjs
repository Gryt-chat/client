// Note: CommonJS because electron-builder loads a JS config through require().

const fs = require("node:fs");
const path = require("node:path");

const yaml = require("js-yaml");

const { prunePrebuilds } = require("./scripts/prune-prebuilds.cjs");

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

/**
 * `GRYT_MAS=1` is the Mac App Store build (GRYT-1273). The DMG never sets it.
 * Files a sandboxed app writes can't be run, so the runtime ships unpacked in the bundle.
 */
const MAS = process.env.GRYT_MAS === "1";

/** Gryt's Apple team. The app group and application identifier are prefixed with it. */
const MAS_TEAM_ID = "8883W2XTQ8";

/** Kept in step with MAS_RUNTIME_SOURCE in scripts/variant.mjs. */
const MAS_RUNTIME = {
  from: "build/embedded-server/",
  to: "embedded-server/",
  // What the archive holds, with the SFU for the arch being packed.
  filter: ["versions.json", "server/**/*", "worker/**/*", "sfu/mac-${arch}/**/*"],
};

if (MAS) {
  config.extraResources = config.extraResources.filter(
    (entry) => !String(entry.from).startsWith(EMBEDDED_RESOURCE_PREFIX),
  );
  if (!SLIM) config.extraResources.push(MAS_RUNTIME);

  config.mac = {
    ...config.mac,
    // arm64 only: build/embedded-server holds one arch's SFU and sharp.
    target: [{ target: "mas", arch: ["arm64"] }],
    // Read off `mac`, not `mas`: electron-builder writes Info.plist from the mac options.
    extendInfo: {
      ...config.mac.extendInfo,
      ITSAppUsesNonExemptEncryption: false,
      // Otherwise it is parsed from the certificate name, which for Apple Development is a person, not the team.
      ElectronTeamID: MAS_TEAM_ID,
    },
  };

  if (process.env.GRYT_MAS_PROVISIONING_PROFILE) {
    config.mas = { ...config.mas, provisioningProfile: process.env.GRYT_MAS_PROVISIONING_PROFILE };
  }
}

// Native prebuilds for platforms this package cannot run on. A hook rather than
// a `files` exclude because app-builder-lib takes only `!` patterns for
// node_modules -- see scripts/prune-prebuilds.cjs.
config.afterPack = async (context) => {
  const { Arch } = require("builder-util");
  const { kept, removed } = prunePrebuilds(
    context.appOutDir,
    context.electronPlatformName,
    Arch[context.arch],
  );
  if (removed.length > 0) {
    console.log(`  • pruned prebuilds  kept=${kept.join(", ")} removed=${removed.join(", ")}`);
  }
};

module.exports = config;
