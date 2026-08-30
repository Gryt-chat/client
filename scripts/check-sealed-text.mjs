/* eslint-env node */

/**
 * A message this client cannot read says so (GRYT-729, GRYT-758).
 *
 * `sealedState` was set on every sealed message from the start and drawn
 * nowhere, so three of its four states were a row with a name, a time and
 * nothing between them. Which reads as a bug in the app rather than as a
 * message this device cannot open — and one of the three is the ordinary case
 * of joining a group conversation that already had messages in it.
 *
 * The wording is checked here, and the fact that `MessageRow` draws it is read
 * as source: that file imports React, framer-motion and a markdown renderer,
 * none of which load in Node.
 *
 * The four answers have to match the mobile app's `src/chat/sealedText.ts`. Two
 * clients describing one state differently is worse than either wording.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { sealedPlaceholder } from "../src/packages/socket/src/utils/sealedText.ts";

/* ── nothing to say about a message with words in it ─────────────────────── */

{
  assert.equal(sealedPlaceholder({ sealed: null }), null, "never sealed");
  assert.equal(sealedPlaceholder({}), null, "not sealed at all");

  // `text` is the message once it is open. A placeholder here would draw over
  // the words it was standing in for.
  assert.equal(sealedPlaceholder({ sealed: "{}", sealedState: "open" }), null);
}

/* ── the three unopened states are three different sentences ─────────────── */

{
  const locked = sealedPlaceholder({ sealed: "{}", sealedState: "locked" });
  const broken = sealedPlaceholder({ sealed: "{}", sealedState: "broken" });
  const opening = sealedPlaceholder({ sealed: "{}", sealedState: "opening" });
  // The render between a sealed message arriving and the effect marking it.
  const unset = sealedPlaceholder({ sealed: "{}" });

  for (const [name, value] of Object.entries({ locked, broken, opening, unset })) {
    assert.ok(value, `${name} draws an empty bubble`);
  }

  assert.equal(new Set([locked, broken, opening]).size, 3,
    "locked, broken and opening mean three different things and cannot share a sentence");

  // Joining a group conversation that already had messages in it produces one
  // of these per message. An alarm there would go off constantly, about nothing.
  assert.doesNotMatch(locked, /error|failed|could not|broken/i,
    "a message from before you joined is not a failure");

  // The two reasons a message does not open — tampering, or the wrong
  // conversation — are identical from here, so neither gets named.
  assert.doesNotMatch(broken, /tamper|attack|server/i,
    "broken must not pick a cause it cannot tell apart");
}

/* ── and the row actually draws it ───────────────────────────────────────── */

{
  const row = readFileSync(
    new URL("../src/packages/socket/src/components/MessageRow.tsx", import.meta.url),
    "utf8",
  );

  assert.match(row, /sealedPlaceholder\(m\)/,
    "MessageRow does not ask for a placeholder, which is the bug: sealedState was computed and drawn nowhere");
  assert.match(row, /\{sealedNote \?/,
    "MessageRow works out a placeholder and does not draw it");

  // Not through the markdown renderer. This is the client talking rather than
  // something anybody wrote, so parsing it would linkify it, scan it for
  // profanity and hand it to the embed loader.
  const branch = row.slice(row.indexOf("{sealedNote ?"), row.indexOf("{sealedNote ?") + 600);
  assert.doesNotMatch(branch.slice(0, branch.indexOf(") : (")), /MarkdownRenderer/,
    "a placeholder must not be rendered as markdown");
}

console.log(
  "sealed text: four states, four answers, and the row draws them without parsing them",
);
