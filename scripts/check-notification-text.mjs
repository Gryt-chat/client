/* eslint-env node */

/**
 * The text a desktop notification shows has to read like the message, not
 * like its markdown. A join message's mention was the one Sivert caught raw.
 */

import assert from "node:assert/strict";

const { toPlainNotificationText, notificationBody } = await import(
  "../src/packages/lib/desktopNotification.ts"
);

// The join/leave system message, verbatim from formatJoinMessage/formatLeaveMessage.
assert.equal(
  toPlainNotificationText("[@Carlo](mention:user_42) joined the server"),
  "@Carlo joined the server",
);
assert.equal(
  toPlainNotificationText("[@Carlo](mention:user_42) left the server"),
  "@Carlo left the server",
);

// A mention typed under a since-changed nickname still carries the label, not the id.
assert.equal(toPlainNotificationText("hey [@Siv](mention:user_me) look at this"), "hey @Siv look at this");
// A plain @nickname the composer never linked needs no change.
assert.equal(toPlainNotificationText("hey @Sivert look at this"), "hey @Sivert look at this");
// A label that came through empty reads as somebody rather than nothing.
assert.equal(toPlainNotificationText("[@](mention:user_42) joined the server"), "@someone joined the server");

// Custom emoji shortcodes are already plain text; nothing here should touch them.
assert.equal(toPlainNotificationText("nice one :party_owl:"), "nice one :party_owl:");

// Markdown syntax is gone, not literal.
assert.equal(toPlainNotificationText("**bold** and _italic_ and ~~gone~~"), "bold and italic and gone");
assert.equal(toPlainNotificationText("run `yarn test` please"), "run yarn test please");
assert.equal(toPlainNotificationText("```js\nconst x = 1;\n```"), "const x = 1;");
assert.equal(toPlainNotificationText("# heading\nbody"), "heading\nbody");
assert.equal(toPlainNotificationText("> quoted line"), "quoted line");
assert.equal(toPlainNotificationText("- one\n- two"), "one\ntwo");
assert.equal(toPlainNotificationText("check [this](https://gryt.chat)"), "check this");
assert.equal(toPlainNotificationText("![a screenshot](https://gryt.chat/x.png)"), "a screenshot");

// A mention next to markdown: both resolve in the same pass.
assert.equal(
  toPlainNotificationText("**[@Carlo](mention:user_42)** please review"),
  "@Carlo please review",
);

// notificationBody, the function the two notification call sites actually use,
// runs text through the same conversion before truncating.
assert.equal(
  notificationBody({ text: "[@Carlo](mention:user_42) joined the server" }),
  "@Carlo joined the server",
);

console.log("notification text: ok");
