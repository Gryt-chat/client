/* eslint-env node */

// The banner's three states, and the rule that picks between them. Two clients
// can disagree about one conversation and neither is told (GRYT-1124).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIEW = "src/packages/socket/src/components/ChatView.tsx";
const NOTICE = "src/packages/socket/src/components/DirectMessagePrivacyNotice.tsx";
const view = readFileSync(join(root, VIEW), "utf8");
const notice = readFileSync(join(root, NOTICE), "utf8");

/** Everything from `opener` to the brace that closes the block it opens. */
function block(text, opener, what) {
  const at = text.indexOf(opener);
  assert.ok(at >= 0, `no longer has ${what}`);
  const start = at + opener.length - 1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${what}`);
}

/** The memo body as itself, so the rule runs rather than being read. */
const body = block(view, "const peerInClear = useMemo(() => {", "the peerInClear memo");
const decide = new Function(
  "conversationKind", "sealing", "chatMessages", "currentUserId", "getSenderName",
  `return (() => ${body})();`,
);

const name = (m) => m.sender_nickname;
const run = (opts) =>
  decide(opts.kind ?? "dm", opts.sealing, opts.messages ?? [], "me", name);

const them = (sealed, id = "them") => ({ sender_server_id: id, sender_nickname: "Carlo", sealed });
const mine = (sealed) => ({ sender_server_id: "me", sender_nickname: "Sivert", sealed });

// The case this exists for: we seal, their newest arrived in the clear.
assert.equal(
  run({ sealing: { kind: "seal" }, messages: [them(true), mine(true), them(false)] }),
  "Carlo",
  "a conversation we are sealing, with their newest message unsealed, says nothing",
);

// They are sealing too. Nothing to report.
assert.equal(run({ sealing: { kind: "seal" }, messages: [them(false), them(true)] }), null);

/* History. A conversation older than encryption is full of unsealed messages,
   and only the newest one from them says what their app is doing now. */
assert.equal(run({ sealing: { kind: "seal" }, messages: [them(false), mine(false), them(true)] }), null);

/* A loop stopping at the last message rather than the last of theirs would
   read our own unsealed message as evidence about them. */
assert.equal(run({ sealing: { kind: "seal" }, messages: [them(true), mine(false)] }), null);
assert.equal(run({ sealing: { kind: "seal" }, messages: [them(true), mine(false), mine(false)] }), null);

// Nothing from them at all.
assert.equal(run({ sealing: { kind: "seal" }, messages: [mine(true)] }), null);
assert.equal(run({ sealing: { kind: "seal" }, messages: [] }), null);

/* Not sealing ourselves. The banner already says the conversation is in the
   clear, and naming one person on top of that reads as blame. */
assert.equal(run({ sealing: { kind: "plaintext", blockedBy: [] }, messages: [them(false)] }), null);
assert.equal(run({ sealing: undefined, messages: [them(false)] }), null);

// A channel is never sealed and never says any of this.
assert.equal(run({ kind: "channel", sealing: { kind: "seal" }, messages: [them(false)] }), null);

/* ── and the banner draws a third thing when it is handed one ─────────────── */

assert.match(notice, /peerInClear/, `${NOTICE} no longer takes peerInClear`);
assert.match(
  notice,
  /const oneWay = sealed && !!peerInClear;/,
  `${NOTICE} decides the one-way state some other way than sealed-and-named`,
);
assert.match(notice, /You are encrypting, \{peerInClear\} isn&rsquo;t\./, `${NOTICE} lost the one-way sentence`);

/* The open padlock, because half of it is readable. Drawing the closed one here
   was the whole complaint. */
assert.match(
  notice,
  /const Icon = sealed && !oneWay \? PiLockSimpleFill : PiLockOpen;/,
  `${NOTICE} draws a closed padlock while the other side sends in the clear`,
);

console.log("peer in clear: named when we seal and their newest did not, quiet otherwise");
