/* eslint-env node */

/**
 * What a server is allowed to put on this screen. Every word ships in the client:
 * a panel carrying the server's text is phishing with a border (GRYT-896).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseServerNotice } from "../src/packages/common/src/hooks/useServerNotice.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ── A well-formed notice comes through unchanged ────────────────────────── */

assert.deepEqual(
  parseServerNotice({ kind: "outdated_client", version: "1.6.24" }),
  { kind: "outdated_client", version: "1.6.24" },
  "a valid notice should survive the door",
);

/* ── A value cannot be a sentence ────────────────────────────────────────── */

const NASTY_VERSIONS = [
  "1.6.24 — your session expired, sign in at evil.example.com",
  "[click here](https://evil.example.com)",
  "<a href='https://evil.example.com'>click</a>",
  "https://evil.example.com",
  "1.6.24\nSign in again:",
  "latest",
  "1.6",
  "1.6.24.1",
  "",
  " ",
];

for (const version of NASTY_VERSIONS) {
  assert.equal(
    parseServerNotice({ kind: "outdated_client", version }),
    null,
    `let a version through that is not a version: ${JSON.stringify(version)}`,
  );
}

/* ── A kind this build does not know renders as nothing, not as something ── */

assert.equal(parseServerNotice({ kind: "server_announcement", text: "hi" }), null);
assert.equal(parseServerNotice({ kind: "outdated_client" }), null, "missing value");
assert.equal(parseServerNotice({ version: "1.6.24" }), null, "missing kind");
assert.equal(parseServerNotice(null), null);
assert.equal(parseServerNotice("outdated_client"), null);
assert.equal(parseServerNotice(42), null);

/* ── Extra fields are dropped rather than carried ─────────────────────────── */

const smuggled = parseServerNotice({
  kind: "outdated_client",
  version: "1.6.24",
  message: "Your session has expired. Sign in at evil.example.com",
  url: "https://evil.example.com",
});

assert.deepEqual(
  smuggled,
  { kind: "outdated_client", version: "1.6.24" },
  "a field the client does not name must not survive the parse",
);

/* ── The panel's copy is the client's, and its links are ours ─────────────── */

const panel = readFileSync(
  join(HERE, "../src/packages/socket/src/components/ServerNoticePanel.tsx"),
  "utf8",
);

/*
 * The panel may only ever build a URL from a constant it declares itself. A
 * notice field interpolated into an href would typecheck and look reasonable.
 */
for (const smell of ["notice.url", "notice.href", "notice.link", "notice.message", "notice.text"]) {
  assert.ok(
    !panel.includes(smell),
    `ServerNoticePanel reads ${smell} from the notice. The server sends a kind ` +
      `and values, never text or a destination — add a case to copyFor instead.`,
  );
}

/*
 * And every destination it does use is a literal, on a host we own. Read out of
 * the source, so adding a link elsewhere is a failing check.
 */
const hrefs = [...panel.matchAll(/https?:\/\/[^"'` )]+/g)].map((m) => m[0]);
assert.ok(hrefs.length > 0, "expected the panel to carry at least one link of its own");
for (const href of hrefs) {
  assert.ok(
    /^https:\/\/(gryt\.chat|docs\.gryt\.chat)\//.test(href),
    `ServerNoticePanel links to ${href}, which is not a Gryt host`,
  );
}

console.log("check-server-notice: ok");
