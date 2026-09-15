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
const ROW = "src/packages/socket/src/components/MessageRow.tsx";
const ATTACHMENT = "src/packages/socket/src/components/MessageAttachment.tsx";
const PLAYER = "src/packages/socket/src/components/ChatMediaPlayer.tsx";
const EMBEDS = "src/packages/socket/src/components/EmbedRenderers.tsx";
const REPORTS = "src/packages/socket/src/components/ReportsPanel.tsx";
const SEALED_HOOK = "src/packages/socket/src/hooks/useSealedVideo.ts";

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

const player = read(PLAYER);
const embeds = read(EMBEDS);
const videoPlayer = player.match(/<VideoPlayer\b[\s\S]*?\/>/)?.[0];
assert.ok(videoPlayer, `${PLAYER} no longer draws VideoPlayer`);
for (const wire of ["onError={onError}", "onPosterError={onPosterError}"]) {
  assert.ok(videoPlayer.includes(wire), `${PLAYER} lost ${wire} on VideoPlayer, so a stale token never recovers`);
}
assert.doesNotMatch(player, /addEventListener\("error"/, `${PLAYER} listens for load errors by hand again; VideoPlayer reports them`);

/* ── nothing loads a video before the click ─────────────────────────────── */

for (const [path, source] of [[PLAYER, player], [EMBEDS, embeds]]) {
  assert.doesNotMatch(source, /<video\b/, `${path} draws its own <video> again, next to VideoPlayer`);
  assert.doesNotMatch(source, /autoLoad/, `${path} sets autoLoad, which fetches the video before anybody presses play`);
}
const embed = embeds.slice(embeds.indexOf("export const VideoEmbed"), embeds.indexOf("export const TwitchEmbed"));
assert.match(embed, /<VideoPlayer\b/, `${EMBEDS}'s VideoEmbed no longer uses VideoPlayer`);

/* ── the reports panel draws attachments the same way ───────────────────── */

const reports = read(REPORTS);
assert.doesNotMatch(reports, /getUploadsFileUrl\(/, `${REPORTS} builds an upload URL during render again`);
assert.doesNotMatch(reports, /<video\b/, `${REPORTS} draws its own <video> again, which loads before play`);
assert.match(reports, /useStableFileUrl\(serverHost, fileId\)/, `${REPORTS} no longer holds the file URL`);
assert.match(reports, /useStableFileUrl\(serverHost, fileId, true\)/, `${REPORTS} no longer holds the thumbnail URL`);
const reportVideo = reports.match(/<ChatMediaPlayer\b[\s\S]*?\/>/)?.[0];
assert.ok(reportVideo, `${REPORTS} no longer plays videos through ChatMediaPlayer`);
for (const wire of ['type="video"', "src={url}", "onError={refreshUrl}", "onPosterError={refreshThumb}"]) {
  assert.ok(reportVideo.includes(wire), `${REPORTS} lost ${wire} on its video player`);
}
assert.match(reports, /<img\b[^>]*?onError=\{refreshUrl\}/, `${REPORTS}'s image lost onError, so a stale token never recovers`);
// The player is 480px wide, and content sized to fit it pushed Dismiss, Delete and Ban out of view.
assert.match(reports, /<ScrollArea\.Content style=\{\{ minWidth: 0 \}\}>/, `${REPORTS} lets its content grow past the dialog again`);

/* ── an encrypted video fetches and decrypts on the press ───────────────── */

assert.match(
  attachment,
  /if \(mime\.startsWith\("video\/"\) && meta\?\.open_sealed\) \{\s*return \([\s\S]*?<ChatSealedVideo\b[^>]*?open=\{meta\.open_sealed\}/,
  `${ATTACHMENT} no longer hands an unopened encrypted video to ChatSealedVideo`,
);
const sealedPlayer = player.slice(player.indexOf("export function ChatSealedVideo"));
assert.match(sealedPlayer, /<div inert=\{!src\}>\s*<VideoPlayer\s+src=\{src \?\? ""\}/,
  `${PLAYER}'s encrypted player can be started before there is anything to play`);

const sealedHookSource = stripTypeScriptTypes(read(SEALED_HOOK)).replace(/^import .*$/gm, "").replace(/^export /gm, "");
const useSealedVideo = new Function("useState", "useRef", "useEffect", "useCallback", `${sealedHookSource}\nreturn useSealedVideo;`);

/** Enough of React to run one hook: state, refs, callbacks, effects with cleanups, and unmounting. */
function mountHook(makeHook, args) {
  const slots = [];
  let slot = 0;
  let dirty = false;
  let result;
  let pending = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hook = makeHook(
    (init) => {
      const i = slot++;
      if (!(i in slots)) slots[i] = { value: typeof init === "function" ? init() : init };
      const cell = slots[i];
      return [cell.value, (next) => {
        const value = typeof next === "function" ? next(cell.value) : next;
        if (!Object.is(value, cell.value)) { cell.value = value; dirty = true; }
      }];
    },
    (init) => {
      const i = slot++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i];
    },
    (fn, deps) => {
      const i = slot++;
      if (slots[i] && same(slots[i].deps, deps)) return;
      pending.push({ i, fn, deps });
    },
    (fn, deps) => {
      const i = slot++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
  );
  const render = () => {
    do {
      dirty = false;
      slot = 0;
      result = hook(...args);
    } while (dirty);
    for (const { i, fn, deps } of pending) {
      slots[i]?.cleanup?.();
      slots[i] = { deps, cleanup: fn() };
    }
    pending = [];
    return result;
  };
  render();
  return {
    get now() { return result; },
    render,
    unmount() { for (const cell of slots) cell?.cleanup?.(); },
  };
}

const revoked = [];
const realRevoke = URL.revokeObjectURL;
URL.revokeObjectURL = (url) => { revoked.push(url); realRevoke(url); };
const later = () => { let settle; const promise = new Promise((resolve, reject) => { settle = { resolve, reject }; }); return { promise, ...settle }; };
const clip = new Blob(["frames"], { type: "video/webm" });

{
  let calls = 0;
  let wait = later();
  const video = mountHook(useSealedVideo, [() => { calls++; return wait.promise; }]);
  assert.equal(calls, 0, "an encrypted video was fetched before anybody pressed play");
  assert.deepEqual([video.now.src, video.now.phase], [null, "idle"]);

  video.now.start();
  video.render();
  video.now.start();
  assert.equal(calls, 1, "a second press while it decrypts fetched the file again");
  assert.equal(video.now.phase, "opening", "nothing shows the file is on its way");

  wait.reject(new Error("503"));
  await wait.promise.catch(() => {});
  video.render();
  assert.deepEqual([video.now.src, video.now.phase], [null, "failed"], "a failed fetch is not shown as one");

  wait = later();
  video.now.start();
  video.render();
  assert.equal(calls, 2, "Try again did not fetch again");
  wait.resolve(clip);
  await wait.promise;
  video.render();
  assert.match(video.now.src ?? "", /^blob:/, "the decrypted video never reached the player");
  const src = video.now.src;
  video.now.start();
  assert.equal(calls, 2, "a press after it opened fetched it again");
  video.unmount();
  assert.ok(revoked.includes(src), "the decrypted video's blob URL outlives its player");
}

{
  const wait = later();
  const video = mountHook(useSealedVideo, [() => wait.promise]);
  video.now.start();
  video.render();
  video.unmount();
  revoked.length = 0;
  wait.resolve(clip);
  await wait.promise;
  await Promise.resolve();
  assert.equal(revoked.length, 1, "a video that finished decrypting after its player went keeps its blob URL forever");
}
URL.revokeObjectURL = realRevoke;

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
