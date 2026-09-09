/* eslint-env node */

// The empty direct conversation and the banner above it, run as themselves. They
// said opposite things about who can read it for two months (GRYT-1116).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const EMPTY = "src/packages/socket/src/components/ChatMessage.tsx";
const BANNER = "src/packages/socket/src/components/DirectMessagePrivacyNotice.tsx";
const empty = readFileSync(join(root, EMPTY), "utf8");
const banner = readFileSync(join(root, BANNER), "utf8");

/** The `{...}` children of the paragraph, past the attributes, as an expression. */
function expression(source, after, what) {
  const at = source.indexOf(after);
  assert.ok(at >= 0, `${EMPTY} no longer has ${what}`);

  /* Skip the opening tag. Its style attribute is braces too, so walk to the `>`
     that sits at depth zero rather than taking the first brace. */
  let attrs = 0;
  let i = at + after.length;
  for (; i < source.length; i++) {
    if (source[i] === "{") attrs++;
    else if (source[i] === "}") attrs--;
    else if (source[i] === ">" && attrs === 0) break;
  }

  const start = source.indexOf("{", i);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start + 1, i);
  }
  throw new Error(`unbalanced braces in ${what}`);
}

const body = expression(
  empty,
  '<p className="mt-2 text-lg text-gryt-muted"',
  "the paragraph under the heading",
);

const line = new Function("conversationKind", "sealing", "automated", `return (${body});`);

/* A conversation the client is actually sealing. */
const sealed = line("dm", { kind: "seal" }, false);
assert.match(sealed, /can.t open|can.t read/, `a sealed conversation says: ${sealed}`);
assert.doesNotMatch(
  sealed,
  /whoever runs the server can read|can too/i,
  `a sealed conversation tells you the server can read it: ${sealed}`,
);

/* Not sealing, for whatever reason the banner goes on to name. */
const plain = line("dm", { kind: "plaintext", blockedBy: [] }, false);
assert.match(plain, /whoever runs the server can read/i, `an unsealed conversation says: ${plain}`);

/* Before the keys have loaded. Understating the protection is the safe way to be
   wrong, which is the rule the banner already follows. */
const unknown = line("dm", undefined, false);
assert.equal(unknown, plain, "an unknown seal state promises more than an unsealed one");

/* A channel is not a direct conversation and makes no claim either way. */
for (const automated of [true, false]) {
  const channel = line("channel", undefined, automated);
  assert.doesNotMatch(channel, /encrypted|whoever runs the server/i, `a channel says: ${channel}`);
}

/* And the banner above it still says both halves, so the two cannot drift into
   agreeing with each other by accident. */
assert.match(banner, /This conversation is encrypted\./, `${BANNER} lost its sealed sentence`);
assert.match(banner, /This conversation isn&rsquo;t encrypted\./, `${BANNER} lost its plaintext sentence`);

console.log("empty dm copy: sealed says encrypted, unsealed and unknown say the server can read it");
