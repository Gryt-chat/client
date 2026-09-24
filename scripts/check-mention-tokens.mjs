/* eslint-env node */

/**
 * GRYT-1455. mentionTokens.ts is the same file in mobile, and mention-vectors.json
 * the same file in mobile and server, so the three agree on what a mention is.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { mentionTarget, massMentionHits, plainMentionTokens } = await import(
  "../src/packages/lib/mentionTokens.ts"
);
const vectors = JSON.parse(
  readFileSync(new URL("../src/packages/lib/mention-vectors.json", import.meta.url), "utf8"),
);

for (const v of vectors.targets) {
  assert.deepEqual(mentionTarget(v.href), v.target, v.href);
}
for (const v of vectors.hits) {
  assert.equal(massMentionHits(v.text, v.viewer), v.hit, `${v.text} ${JSON.stringify(v.viewer)}`);
}
for (const v of vectors.plain) {
  const name = (id, host) => v.channels[host ? `${host}/${id}` : id] ?? null;
  assert.equal(plainMentionTokens(v.text, name), v.plain, v.text);
}

const { toPlainNotificationText } = await import("../src/packages/lib/desktopNotification.ts");
const names = (id) => (id === "chan_a" ? "general" : null);
assert.equal(
  toPlainNotificationText("[@everyone](mention:everyone) see [#channel](channel:chan_a)", names),
  "@everyone see #general",
);
assert.equal(
  toPlainNotificationText("[@Mods](role:mods) and [#channel](channel:chan_z)", names),
  "@Mods and #private-channel",
);
assert.equal(toPlainNotificationText("[#channel](channel:chan_a)"), "#private-channel");

// Only mentions: the same question the notification path asks.
const { mentionsMember } = await import("../src/packages/common/src/hooks/notificationPrefs.ts");
const person = { sender_server_id: "user_a" };
assert.equal(mentionsMember({ ...person, text: "[@everyone](mention:everyone) hi" }, { serverUserId: "user_b" }), true);
assert.equal(
  mentionsMember({ ...person, text: "[@everyone](mention:everyone) hi" }, { serverUserId: "user_b", suppressEveryone: true }),
  false,
);
assert.equal(mentionsMember({ ...person, text: "[@Mods](role:mods)" }, { serverUserId: "user_b", roleIds: ["mods"] }), true);
assert.equal(mentionsMember({ ...person, text: "[@Mods](role:mods)" }, { serverUserId: "user_b", roleIds: [] }), false);
assert.equal(mentionsMember({ sender_server_id: "webhook:x", text: "[@everyone](mention:everyone)" }, {}), false);

console.log("mention tokens: ok");
