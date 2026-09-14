/* eslint-env node */

// An attachment's URL carries the file token, which changes on every refresh. The URL has to
// stay put while the attachment is mounted, and a video must not load until clicked. GRYT-1166, GRYT-1174.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const HOOK = "src/packages/socket/src/hooks/useStableFileUrl.ts";
const ERRORS = "src/packages/socket/src/hooks/useMediaErrors.ts";
const ROW = "src/packages/socket/src/components/MessageRow.tsx";
const ATTACHMENT = "src/packages/socket/src/components/MessageAttachment.tsx";
const PLAYER = "src/packages/socket/src/components/ChatMediaPlayer.tsx";
const EMBEDS = "src/packages/socket/src/components/EmbedRenderers.tsx";

/* ── the hook, run with a tiny useState ─────────────────────────────────── */

const hookSource = stripTypeScriptTypes(read(HOOK))
  .replace(/^import .*$/gm, "")
  .replace(/^export /gm, "");
const useStableFileUrl = new Function(
  "useState",
  "useCallback",
  "getUploadsFileUrl",
  `${hookSource}\nreturn useStableFileUrl;`,
);

let token = "A";
const requested = [];
function getUploadsFileUrl(host, fileId, opts) {
  requested.push({ host, fileId, opts });
  return `http://${host}/api/uploads/files/${fileId}?${opts?.thumb ? "thumb=1&" : ""}t=${token}`;
}

/** One mounted component: state survives renders, and a set during render renders again. */
function mount(initialProps) {
  const slots = [];
  let props = initialProps;
  let result;
  let dirty = false;
  let slot = 0;

  const useState = (init) => {
    const i = slot++;
    if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init;
    const set = (next) => {
      const value = typeof next === "function" ? next(slots[i]) : next;
      if (!Object.is(value, slots[i])) {
        slots[i] = value;
        dirty = true;
      }
    };
    return [slots[i], set];
  };
  const callbacks = [];
  const useCallback = (fn) => {
    const i = slot++;
    if (!(i in callbacks)) callbacks[i] = fn;
    return callbacks[i];
  };
  const hook = useStableFileUrl(useState, useCallback, getUploadsFileUrl);

  const render = () => {
    let passes = 0;
    do {
      dirty = false;
      slot = 0;
      result = hook(props.host, props.fileId, props.thumb);
      assert.ok(++passes < 10, `${HOOK} keeps setting state during render`);
    } while (dirty);
    return result;
  };
  render();
  return {
    get url() { return result[0]; },
    refresh() { dirty = false; result[1](); return dirty; },
    render(next) { if (next) props = { ...props, ...next }; return render(); },
  };
}

{
  token = "A";
  const file = mount({ host: "chat.example", fileId: "f1" });
  assert.match(file.url, /t=A$/, "the first render does not carry the token it was mounted with");

  token = "B";
  file.render();
  assert.match(file.url, /t=A$/, "a token refresh changed the URL of a mounted attachment, which reloads it");

  assert.equal(file.refresh(), true, "refresh after a failed load did not change anything");
  file.render();
  assert.match(file.url, /t=B$/, "refresh did not swap in the current token");

  assert.equal(file.refresh(), false, "a second failure with the same token retries the URL that just failed");
  assert.match(file.render()[0], /t=B$/);
}

{
  token = "A";
  const file = mount({ host: "chat.example", fileId: "f1" });
  assert.equal(file.refresh(), false, "refresh with an unchanged token re-renders for nothing");
}

{
  token = "A";
  const thumb = mount({ host: "chat.example", fileId: "f1", thumb: true });
  assert.match(thumb.url, /thumb=1/, "the thumbnail URL lost thumb=1");
  token = "B";
  thumb.refresh();
  thumb.render();
  assert.match(thumb.url, /thumb=1&t=B$/, "refreshing a thumbnail dropped thumb=1");
}

{
  token = "A";
  const file = mount({ host: "chat.example", fileId: "f1" });
  token = "B";
  file.render({ fileId: "f2" });
  assert.match(file.url, /files\/f2\?t=B$/, "a different file kept the old file's URL");
  file.render({ host: "other.example" });
  assert.match(file.url, /^http:\/\/other\.example\//, "a different server kept the old server's URL");
}

/* ── where the URLs are built ───────────────────────────────────────────── */

const row = read(ROW);
assert.doesNotMatch(
  row,
  /getUploadsFileUrl\(/,
  `${ROW} builds an upload URL during render again. Each render then carries the newest token.`,
);
assert.match(row, /<MessageAttachment\s+key=\{fileId\}/, `${ROW} no longer draws attachments through MessageAttachment`);

const attachment = read(ATTACHMENT);
assert.doesNotMatch(attachment, /getUploadsFileUrl\(/, `${ATTACHMENT} builds a URL outside useStableFileUrl`);
assert.match(attachment, /useStableFileUrl\(serverHost, fileId\)/, `${ATTACHMENT} no longer holds the file URL`);
assert.match(attachment, /useStableFileUrl\(serverHost, fileId, true\)/, `${ATTACHMENT} no longer holds the thumbnail URL`);
for (const wire of ["onError={local ? undefined : refreshUrl}", "onPosterError={refreshThumb}"]) {
  assert.ok(attachment.includes(wire), `${ATTACHMENT} lost ${wire}, so a stale token never recovers`);
}

/* ── a failed video or poster reaches the refresh ──────────────────────── */

const errorsSource = stripTypeScriptTypes(read(ERRORS)).replace(/^import .*$/gm, "").replace(/^export /gm, "");
const useMediaErrors = new Function("useEffect", `${errorsSource}\nreturn useMediaErrors;`);

{
  const calls = [];
  const listeners = [];
  const root = {
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn, capture) => {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (i !== -1) listeners.splice(i, 1);
    },
  };
  let cleanup;
  const hook = useMediaErrors((effect) => { cleanup = effect(); });
  hook({ current: root }, () => calls.push("video"), () => calls.push("image"));

  assert.equal(listeners.length, 1, `${ERRORS} does not listen for errors`);
  assert.equal(listeners[0].type, "error");
  assert.equal(listeners[0].capture, true, `${ERRORS} listens in the bubble phase, where load errors never arrive`);
  for (const tagName of ["VIDEO", "IMG", "DIV"]) listeners[0].fn({ target: { tagName } });
  assert.deepEqual(calls, ["video", "image"], `${ERRORS} sends errors to the wrong handler`);
  cleanup();
  assert.equal(listeners.length, 0, `${ERRORS} leaves its listener behind on unmount`);
}

/* ── nothing loads a video before the click ─────────────────────────────── */

const player = read(PLAYER);
const embeds = read(EMBEDS);
for (const [path, source] of [[PLAYER, player], [EMBEDS, embeds]]) {
  assert.doesNotMatch(source, /<video\b/, `${path} draws its own <video> again, next to VideoPlayer`);
  assert.doesNotMatch(source, /autoLoad/, `${path} sets autoLoad, which fetches the video before anybody presses play`);
}
assert.match(player, /useMediaErrors\(ref, onError, onPosterError\)/, `${PLAYER} no longer passes load errors up`);
assert.match(player, /<div ref=\{ref\}[^>]*>\s*<VideoPlayer\b/, `${PLAYER}'s error listener is not around VideoPlayer`);
const embed = embeds.slice(embeds.indexOf("export const VideoEmbed"), embeds.indexOf("export const TwitchEmbed"));
assert.match(embed, /<VideoPlayer\b/, `${EMBEDS}'s VideoEmbed no longer uses VideoPlayer`);

const audio = [...player.matchAll(/<audio\b[\s\S]*?\/>/g)];
assert.equal(audio.length, 1);
assert.match(audio[0][0], /preload="metadata"/, `${PLAYER}'s audio preload changed. "none" leaves no duration shown.`);

// The installed VideoPlayer itself: idle, it must hold no src and one play button.
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { VideoPlayer } = await import("@gryt/ui");
const html = renderToStaticMarkup(
  createElement(VideoPlayer, { src: "http://chat.example/api/uploads/files/f1?t=A", poster: "http://chat.example/p.jpg", fileName: "clip.mp4" }),
);
const video = html.match(/<video\b[^>]*>/)?.[0];
assert.ok(video, "@gryt/ui VideoPlayer no longer renders a <video>");
assert.doesNotMatch(video, /\ssrc=/, "@gryt/ui VideoPlayer puts src on the video before play, so it downloads");
assert.match(video, /preload="none"/, "@gryt/ui VideoPlayer preloads before play");
assert.doesNotMatch(html, /files\/f1/, "@gryt/ui VideoPlayer uses the file URL somewhere before play");
assert.equal(html.match(/aria-label="Play video"/g)?.length, 1, "an idle VideoPlayer should show exactly one play button");

console.log("stable attachment URLs: ok");
