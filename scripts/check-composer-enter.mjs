/* eslint-env node */

// Enter sends unless a suggestion list shows something to pick. A pasted URL's port
// opened an empty emoji list, and that list ate the first Enter. GRYT-1215.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = "src/packages/socket/src/components";
const read = (file) => readFileSync(join(root, DIR, file), "utf8");
const { emojiQueryAt } = await import(pathToFileURL(join(root, DIR, "emojiQuery.ts")).href);

/** `text` with `|` marking the caret, the way mobile's autocomplete tests read. */
const at = (withCaret) => emojiQueryAt(withCaret.replace("|", ""), withCaret.indexOf("|"));

// ── which colons start a shortcode ─────────────────────────────────

for (const [text, why] of [
  ["http://192.168.50.196:3000|", "the URL from the report opens the emoji list on its port"],
  ["https://example.com:8443/x|", "a colon inside a URL opens the emoji list"],
  ["https://example.com:8443|", "a port at the end of a URL opens the emoji list"],
  ["http://localhost:1234|", "`1234` is an emoji name, so Enter swapped the port for 🔢"],
  ["meet at 12:30|", "`30` matches the clock emojis, so Enter turned the time into 🕥"],
  ["back at 10:00|", "`00` matches `100`, so Enter turned the time into 💯"],
  ["ratio 16:9|", "a ratio opens the emoji list"],
  ["http://192.168.50.196|", "a URL with no port opens the emoji list"],
  ["note:important|", "a colon glued to the word before it opens the emoji list"],
]) {
  assert.equal(at(text), null, why);
}

assert.deepEqual(at(":smile|"), { name: "smile", start: 0 }, "a shortcode at the start is missed");
assert.deepEqual(at("nice :smile|"), { name: "smile", start: 5 }, "a shortcode after a space is missed");
assert.deepEqual(at("nice\u00a0:smile|"), { name: "smile", start: 5 }, "contentEditable's nbsp is a space too");
assert.deepEqual(at("line one\n:smile|"), { name: "smile", start: 9 }, "a new line starts a word");
assert.deepEqual(at("(:smile|"), { name: "smile", start: 1 }, "mobile opens after a bracket, and so should this");
assert.deepEqual(at("great :100|"), { name: "100", start: 6 }, "a name made of digits is still a name");
assert.deepEqual(at("thanks :+1|"), { name: "+1", start: 7 }, "`+1` is a name");
assert.equal(at("nice :s|"), null, "one character is too little to search on");
assert.equal(at("nice :smi|le"), null, "a caret in the middle of a name is an edit, not typing");
assert.equal(at("nice :smile:|"), null, "a finished shortcode is not a query");

// ── who gets the key ───────────────────────────────────────────────

/** Everything from `opener` to the brace that closes the block it opens. */
function block(text, opener, what) {
  const found = text.indexOf(opener);
  assert.ok(found >= 0, `no longer has ${what}`);
  const start = found + opener.length - 1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${what}`);
}

/** The body of a file's `handleKeyDown`, types stripped, to run as itself. */
function keyHandler(file) {
  const source = read(file);
  const start = source.indexOf("const handleKeyDown = useCallback(");
  assert.ok(start >= 0, `${file} no longer has handleKeyDown. Move this check with it.`);
  const body = block(source.slice(start), "=> {", `handleKeyDown in ${file}`);
  return stripTypeScriptTypes(`async () => ${body}`).slice("async () => ".length);
}

/* The lists listen on document in the capture phase. That is what puts them ahead of the
   editor's onKeyDown, which React runs from the root, so the order below is the browser's. */
for (const file of ["EmojiAutocomplete.tsx", "MentionAutocomplete.tsx"]) {
  assert.match(
    read(file),
    /document\.addEventListener\("keydown", handleKeyDown, true\)/,
    `${file} no longer listens in the capture phase, so the editor sees Enter before the list`,
  );
}
assert.match(read("ChatEditor.tsx"), /onKeyDown=\{handleKeyDown\}/, "the editor's key handler is not on the editor");

const LIST_ARGS = ["e", "visible", "results", "selectedIndex", "onSelect", "onClose", "setSelectedIndex", "keyboardNavRef"];
const EDITOR_ARGS = ["e", "handleSend", "isEditing", "onCancel", "onArrowUpEmpty", "editorRef",
  "serializeContentEditable", "pendingFilesRef", "showAutocomplete", "showMentionAutocomplete"];
const emojiList = new Function(...LIST_ARGS, keyHandler("EmojiAutocomplete.tsx"));
const mentionList = new Function(...LIST_ARGS, keyHandler("MentionAutocomplete.tsx"));
const editor = new Function(...EDITOR_ARGS, keyHandler("ChatEditor.tsx"));

/**
 * One key press, as the browser runs it. A list is null when no query opened it,
 * and [] when one did and nothing matched. Returns what happened.
 */
function press(key, { shiftKey = false, emoji = null, mention = null, isEditing = false, text = "hi" } = {}) {
  const happened = [];
  const e = {
    key,
    shiftKey,
    defaultPrevented: false,
    stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    isDefaultPrevented() { return this.defaultPrevented; },
  };
  e.nativeEvent = e;

  for (const [name, handler, results] of [["emoji", emojiList, emoji], ["mention", mentionList, mention]]) {
    if (results === null || e.stopped) continue;
    handler(e, true, results, 0, (r) => happened.push(`${name} picked ${r}`),
      () => happened.push(`${name} closed`), () => {}, { current: false });
  }
  if (!e.stopped) {
    editor(e, () => happened.push("sent"), isEditing, () => happened.push("edit cancelled"),
      () => happened.push("last message recalled"), { current: {} }, () => text, { current: [] },
      emoji !== null, mention !== null);
  }
  // contentEditable's own Enter, when nothing prevented it.
  if (key === "Enter" && !e.defaultPrevented) happened.push("new line");
  return happened;
}

/** The emoji list for `text` as the editor would open it, given what the search finds. */
const emojiFor = (withCaret, matches) => (at(withCaret) ? matches : null);

// The report, pasted or typed: one Enter sends it.
assert.deepEqual(press("Enter", { emoji: emojiFor("http://192.168.50.196:3000|", []) }), ["sent"],
  "Enter after a URL with a port did not send");

// Lists that opened and found nothing hold nothing to pick, so they cannot take Enter.
assert.deepEqual(press("Enter", { emoji: [] }), ["sent"],
  "an emoji list with no matches kept Enter from sending, as `haha :-D` did");
assert.deepEqual(press("Enter", { mention: [] }), ["sent"],
  "a mention list with no matches kept Enter from sending, as `ping @Blizzard when you are back` did");

// A list that shows something still picks with Enter, and nothing is sent.
assert.deepEqual(press("Enter", { emoji: emojiFor("nice :smile|", ["smile", "smiley"]) }), ["emoji picked smile"],
  "Enter no longer picks the highlighted emoji");
assert.deepEqual(press("Tab", { emoji: ["smile"] }), ["emoji picked smile"], "Tab no longer picks the emoji");
assert.deepEqual(press("Enter", { mention: ["Blizzard"] }), ["mention picked Blizzard"],
  "Enter no longer picks the highlighted member");

// Shift+Enter is a new line, with or without an empty list open.
assert.deepEqual(press("Enter", { shiftKey: true }), ["new line"], "Shift+Enter no longer makes a new line");
assert.deepEqual(press("Enter", { shiftKey: true, emoji: [] }), ["new line"], "Shift+Enter sent with an empty list open");
assert.deepEqual(press("Enter"), ["sent"], "plain Enter no longer sends");

// Escape closes a list that shows something, and cancels the edit when there is none.
assert.deepEqual(press("Escape", { isEditing: true, emoji: ["smile"] }), ["emoji closed"],
  "Escape cancelled the edit while the emoji list was showing");
assert.deepEqual(press("Escape", { isEditing: true, emoji: [] }), ["edit cancelled"],
  "Escape did nothing while an empty emoji list was open");

// Arrow up in an empty composer recalls the last message, unless a list is moving its highlight.
assert.deepEqual(press("ArrowUp", { text: "" }), ["last message recalled"], "arrow up no longer recalls");
assert.deepEqual(press("ArrowUp", { text: "", emoji: ["smile"] }), [], "arrow up recalled while moving through the list");

// Opening the list and replacing its query both go through emojiQueryAt, which is checked above.
const chatEditor = read("ChatEditor.tsx");
for (const helper of ["getEmojiQueryAtCursor", "replaceEmojiQueryAtCursor"]) {
  assert.match(block(chatEditor, `function ${helper}(`, helper), /emojiQueryAt\(/,
    `${helper} no longer uses emojiQueryAt, so it can open on ports and times again`);
}

console.log("composer enter: ok, ports and times open no list, and an empty list lets Enter send");
