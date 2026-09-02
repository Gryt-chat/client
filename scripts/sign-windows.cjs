/* eslint-env node */

/**
 * Signs the Windows artefacts, and refuses to let an unsigned one out quietly.
 *
 * Gryt has never signed its Windows builds. That is why people on Windows 11
 * report "An application control policy has blocked this file": Smart App
 * Control looks for a signature when it cannot otherwise vouch for a file, and
 * unsigned means untrusted. Unlike SmartScreen there is no way past it —
 * Microsoft offers no per-app bypass, and turning the feature off is one way,
 * because switching it back on needs a Windows reinstall. See GRYT-848.
 *
 * Two jobs here, and the second one works today.
 *
 * **Signing.** Nothing is configured yet, because a certificate has to be
 * issued to a legal entity and there is not one yet. Until `GRYT_WIN_SIGN_TOOL`
 * names something, this signs nothing and the build behaves exactly as it does
 * now. That is deliberate: a half-written signing step that fails the release
 * would be worse than the problem it is meant to fix.
 *
 * **Telling the truth about it.** Every artefact is checked afterwards for an
 * Authenticode certificate table. With signing configured, an unsigned result
 * fails the build. Without it, the build says plainly that what it just
 * produced will be blocked.
 *
 * The check is the point. Cloud signing CLIs are fond of exiting 0 having done
 * nothing at all — a credential that did not resolve, a keypair alias that
 * matched nothing — and the exit code alone would let that ship. Windows would
 * be the thing that noticed.
 *
 * ## Adding the certificate
 *
 * Set `GRYT_WIN_SIGN_TOOL` to the signing executable and `GRYT_WIN_SIGN_ARGS`
 * to its arguments as a JSON array, with `{file}` where the artefact path goes.
 * Everything else stays in the CA's own environment variables, which all of
 * these tools read directly, so no credential passes through here.
 *
 * DigiCert KeyLocker:
 *   GRYT_WIN_SIGN_TOOL=smctl
 *   GRYT_WIN_SIGN_ARGS=["sign","--keypair-alias","<alias>","--input","{file}"]
 *
 * SSL.com eSigner:
 *   GRYT_WIN_SIGN_TOOL=CodeSignTool
 *   GRYT_WIN_SIGN_ARGS=["sign","-input_file_path={file}","-override=true"]
 *
 * Neither has been run. Whichever is bought, run one release and read the log:
 * the check below reports the certificate table it found, so a signature that
 * did not happen is visible in the build rather than on somebody's desktop.
 */

const { spawnSync } = require("node:child_process");

// A .mjs from CommonJS, so the reader can stay a plain module that the check
// script imports directly. electron-builder awaits what this returns.
const signature = import("./windows-signature.mjs");

/** Only these are worth signing. The rest of what electron-builder emits is
 *  metadata, and handing a .yml to a signing tool is how a build breaks for a
 *  reason nobody enjoys tracking down. */
const SIGNABLE = /\.(exe|dll|msi|node)$/i;

module.exports = async function signWindows(configuration) {
  const file = configuration.path;

  if (!SIGNABLE.test(file)) return;

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
 * `{file}` is substituted rather than appended, because these tools disagree
 * about where the path goes: smctl wants it after --input, CodeSignTool wants
 * it inside -input_file_path=. Appending would work for one and not the other.
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

module.exports.parseArgs = parseArgs;
// Exported so the check can compare it against electron-builder's signExts
// rather than restating the list and letting the two drift.
module.exports.SIGNABLE = SIGNABLE;
