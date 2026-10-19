import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { Arch } from "builder-util";
import type { AfterPackContext, Configuration, MacConfiguration } from "electron-builder";

import { prunePrebuilds } from "./scripts/prune-prebuilds.ts";
import { EMBEDDED_RESOURCE_PREFIX, HELPER_RESOURCE_PREFIX, isMasBuild, isSlimBuild, MAS_RUNTIME_SOURCE } from "./scripts/variant.ts";

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
 * passed electron-builder's arguments. scripts/variant.ts reads it for all three.
 */
const SLIM = isSlimBuild();

// js-yaml ships no types; the YAML is our own.
const yaml = createRequire(import.meta.url)("js-yaml") as { load: (text: string) => Built };

/** The YAML as this file edits it: writable, with the fields it reaches into spelled out. */
type Built = { -readonly [K in keyof Omit<Configuration, "extraResources" | "mac" | "publish">]: Configuration[K] } & {
  extraResources: { from?: string }[];
  mac: MacConfiguration;
  publish: Extract<NonNullable<Configuration["publish"]>, { provider: "github" }>;
};

const config = yaml.load(
  fs.readFileSync(path.join(import.meta.dirname, "electron-builder.yml"), "utf8"),
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
const MAS = isMasBuild();

/** Gryt's Apple team. The app group and application identifier are prefixed with it. */
const MAS_TEAM_ID = "8883W2XTQ8";

const MAS_RUNTIME = {
  from: `${MAS_RUNTIME_SOURCE}/`,
  to: "embedded-server/",
  // What the archive holds, with the SFU for the arch being packed.
  filter: ["versions.json", "server/**/*", "worker/**/*", "sfu/mac-${arch}/**/*"],
};

if (MAS) {
  config.extraResources = config.extraResources.filter(
    (entry) => !String(entry.from).startsWith(EMBEDDED_RESOURCE_PREFIX),
  );
  if (!SLIM) config.extraResources.push(MAS_RUNTIME);

  // The sandbox can't start anything at login, so the store build leaves the helper out.
  config.extraResources = config.extraResources.filter((entry) => !String(entry.from).startsWith(HELPER_RESOURCE_PREFIX));

  config.mac = {
    ...config.mac,
    extraFiles: [],
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
// node_modules -- see scripts/prune-prebuilds.ts.
config.afterPack = async (context: AfterPackContext) => {
  const { kept, removed } = prunePrebuilds(
    context.appOutDir,
    context.electronPlatformName,
    Arch[context.arch],
  );
  if (removed.length > 0) {
    console.log(`  • pruned prebuilds  kept=${kept.join(", ")} removed=${removed.join(", ")}`);
  }
};

export default config;
