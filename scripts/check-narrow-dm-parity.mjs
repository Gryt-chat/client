/* eslint-env node */

// The direct messages redesign landed in the wide layout and not the narrow one, and
// nothing said so. This asserts the two stay in step. GRYT-1144.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const MOBILE = "src/packages/socket/src/components/MobileServerView.tsx";
const WIDE = "src/packages/socket/src/components/ServerSidebar.tsx";
const VIEW = "src/packages/socket/src/components/serverView.tsx";

const mobile = read(MOBILE);
const wide = read(WIDE);
const view = read(VIEW);

/* Direct messages are not a category in either channel list. Whichever layout keeps
   them there is the one somebody is looking at when they say it did not change. */
{
  for (const [file, source] of [[WIDE, wide], [MOBILE, mobile]]) {
    assert.ok(
      /showDirectMessages=\{false\}/.test(source),
      `${file} still lists direct messages as a channel category`,
    );
  }
}

// Clicking somebody opens the conversation, in both layouts.
{
  assert.ok(
    /onOpenDm=\{/.test(mobile),
    `${MOBILE} does not hand MemberSidebar a way to open a conversation`,
  );
  /* Inside the element, not anywhere in the file. The wide layout hands the same
     opener to its own member list, so a loose match passes with this one missing. */
  const element = (() => {
    const at = view.indexOf("<MobileServerView");
    assert.notEqual(at, -1, `${VIEW} no longer renders MobileServerView`);
    const end = view.indexOf("/>", at);
    assert.notEqual(end, -1, `${VIEW} has an unclosed MobileServerView`);
    return view.slice(at, end);
  })();

  assert.ok(
    /onOpenDm=\{requestOpenDm\}/.test(element),
    `${VIEW} stopped giving the narrow layout the same opener the wide one uses`,
  );
  assert.ok(
    /dmSpace=\{dmSpace\}/.test(element),
    `${VIEW} renders the narrow layout without telling it about the direct messages space`,
  );
}

/* The space itself. Without this the button opens a server's own channels, which is
   worse than having no button: the conversation that was open is unreachable. */
{
  assert.ok(
    /<DmSpaceSidebar/.test(mobile),
    `${MOBILE} has no cross-server conversation list, so the space cannot be read there`,
  );
  assert.ok(
    /props\.dmSpace \?/.test(mobile),
    `${MOBILE} ignores dmSpace`,
  );
}

/** The `useCallback(...)` argument list after a marker, parens balanced. */
function callbackAfter(marker) {
  const at = mobile.indexOf(marker);
  assert.notEqual(at, -1, `${MOBILE} no longer has "${marker}". Move this check with it.`);
  const CALL = "useCallback(";
  const open = mobile.indexOf(CALL, at);
  const from = open + CALL.length;
  let depth = 1;
  for (let i = from; i < mobile.length; i++) {
    if (mobile[i] === "(") depth++;
    else if (mobile[i] === ")" && --depth === 0) return mobile.slice(from, i);
  }
  throw new Error(`unbalanced parens after "${marker}" in ${MOBILE}`);
}

/* A sheet covers what it just opened. Both handlers close theirs, or the conversation
   sits behind the list that chose it and it reads as nothing having happened. */
{
  const run = (marker, arg) => {
    /* These two carry annotations only in their parameter lists, and the bodies are
       plain JavaScript. Asserting the strip landed, so a silent miss cannot pass. */
    const source = callbackAfter(marker)
      .replace(/: string/g, "")
      .replace(/: \{ conversation_id[^}]*\}/g, "");
    assert.ok(!/:\s*(string|\{)/.test(source.split("=>")[0]), `types left in ${marker}`);

    const calls = [];
    const made = new Function(
      "useCallback",
      "onOpenDm",
      "props",
      "setMembersOpen",
      "setChannelsOpen",
      `return useCallback(${source});`,
    )(
      (fn) => fn,
      (id) => calls.push(`open:${id}`),
      { onSelectDm: (c) => calls.push(`select:${c.conversation_id}`) },
      (v) => calls.push(`members:${v}`),
      (v) => calls.push(`channels:${v}`),
    );
    made(arg);
    return calls;
  };

  const opened = run("const handleOpenDm =", "member-1");
  assert.ok(opened.includes("open:member-1"), "clicking somebody does not open the conversation");
  assert.ok(opened.includes("members:false"), "the members sheet stays over the conversation it opened");

  const selected = run("const handleSelectDmHere =", { conversation_id: "conv-1" });
  assert.ok(selected.includes("select:conv-1"), "choosing a conversation does not open it");
  assert.ok(selected.includes("channels:false"), "the list stays over the conversation it chose");
}

console.log("narrow dm parity: ok, both layouts open conversations the same way");
