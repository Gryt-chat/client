/* eslint-env node */

/**
 * Signs the Windows artefacts, and refuses to let an unsigned one out quietly.
 * Set `GRYT_WIN_SIGN_TOOL` and `GRYT_WIN_SIGN_ARGS` (JSON, `{file}`) to enable it.
 */

const { spawnSync } = require("node:child_process");

// A .mjs from CommonJS, so the reader can stay a plain module that the check
// script imports directly. electron-builder awaits what this returns.
const signature = import("./windows-signature.mjs");

/** Only these are worth signing. Handing a .yml to a signing tool is how a build
 *  breaks for a reason nobody enjoys tracking down. */
const SIGNABLE = /\.(exe|dll|msi|node)$/i;

/** The MSIX package. Signed the same way and verified differently — a zip with an
 *  AppxSignature.p7x member, not a PE file with a certificate table. */
const PACKAGE = /\.(appx|msix)$/i;

module.exports = async function signWindows(configuration) {
  const file = configuration.path;

  if (PACKAGE.test(file)) return signPackage(file);

  if (!SIGNABLE.test(file)) return;

  // A .node that is not a Windows binary. `uiohook-napi` ships prebuilds for every
  // platform, and the first ELF reaching the reader took v1.9.4 down.
  const { isPortableExecutable } = await signature;
  if (!(await isPortableExecutable(file))) {
    console.log(`  • skipped ${file} (not a Windows binary)`);
    return;
  }

  const tool = (process.env.GRYT_WIN_SIGN_TOOL || "").trim();

  if (tool) {
    const args = parseArgs(process.env.GRYT_WIN_SIGN_ARGS, file);
    const result = spawnSync(tool, args, { stdio: "inherit" });

    if (result.error) {
      throw new Error(`Windows signing: could not run ${tool}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`Windows signing: ${tool} exited ${result.status}`);
    }
  }

  const { readCertificateTable } = await signature;
  const table = await readCertificateTable(file);

  if (table.signed) {
    console.log(`  • signed ${file} (certificate table ${table.size} bytes)`);
    return;
  }

  if (tool) {
    // The failure this whole file exists for. The tool said it worked and the
    // bytes say otherwise, so the tool is wrong and the release stops here.
    throw new Error(
      `Windows signing: ${tool} exited 0 but ${file} has no certificate table. ` +
        "Nothing was signed. Check the CA credentials in the environment.",
    );
  }

  console.warn(
    `  ⚠ ${file} is unsigned. Windows 11 Smart App Control will block it, with ` +
      "no way for the user past it. Set GRYT_WIN_SIGN_TOOL once a certificate " +
      "exists. See GRYT-848.",
  );
};

/**
 * `{file}` is substituted rather than appended: smctl wants it after --input,
 * CodeSignTool inside -input_file_path=.
 */
function parseArgs(raw, file) {
  if (!raw || !raw.trim()) {
    throw new Error("Windows signing: GRYT_WIN_SIGN_TOOL is set but GRYT_WIN_SIGN_ARGS is not");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Windows signing: GRYT_WIN_SIGN_ARGS is not valid JSON: ${err.message}`);
  }

  if (!Array.isArray(parsed) || parsed.some((a) => typeof a !== "string")) {
    throw new Error("Windows signing: GRYT_WIN_SIGN_ARGS must be a JSON array of strings");
  }

  return parsed.map((a) => a.split("{file}").join(file));
}

/**
 * The .appx, which is the same job with a different way of checking. An unsigned
 * package does not install at all, and `-AllowUnsigned` cannot deploy this one.
 */
async function signPackage(file) {
  const tool = (process.env.GRYT_WIN_SIGN_TOOL || "").trim();

  if (tool) {
    const args = parseArgs(process.env.GRYT_WIN_SIGN_ARGS, file);
    const result = spawnSync(tool, args, { stdio: "inherit" });

    if (result.error) {
      throw new Error(`Windows signing: could not run ${tool}: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`Windows signing: ${tool} exited ${result.status}`);
    }
  }

  const { hasAppxSignature } = await signature;

  if (await hasAppxSignature(file)) {
    console.log(`  • signed ${file} (AppxSignature.p7x present)`);
    return;
  }

  if (tool) {
    throw new Error(
      `Windows signing: ${tool} exited 0 but ${file} has no AppxSignature.p7x. ` +
        "Nothing was signed. Check the CA credentials in the environment.",
    );
  }

  console.warn(
    `  ⚠ ${file} is unsigned, so nobody can install it. Windows refuses an ` +
      "unsigned MSIX outright, and -AllowUnsigned does not apply to a package " +
      "that activates an executable. Set GRYT_WIN_SIGN_TOOL once a certificate " +
      "exists, or submit through the Store, which signs it. See GRYT-848.",
  );
}

module.exports.parseArgs = parseArgs;
// Exported so the check can compare it against electron-builder's signExts
// rather than restating the list and letting the two drift.
module.exports.SIGNABLE = SIGNABLE;
module.exports.PACKAGE = PACKAGE;
