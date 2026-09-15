/* eslint-env node */

// Save As, Copy Image and the file card on an encrypted attachment use the decrypted file, never the
// server copy, which is ciphertext. Driven with real encryption and real blob URLs (GRYT-1211).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { openAttachment, sealAttachment } from "@gryt/crypto";

import { openSealedAttachment } from "../src/packages/socket/src/utils/sealedAttachments.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const moduleBody = (path) => stripTypeScriptTypes(read(path)).replace(/^import .*$/gm, "").replace(/^export /gm, "");

const DOWNLOAD = "src/packages/socket/src/utils/downloadFile.ts";
const CLIPBOARD = "src/packages/socket/src/utils/mediaClipboard.ts";
const VIDEO_HOOK = "src/packages/socket/src/hooks/useSealedVideo.ts";
const MENU = "src/packages/socket/src/components/MediaContextMenu.tsx";
const ATTACHMENT = "src/packages/socket/src/components/MessageAttachment.tsx";
const FILE_CARD = "src/packages/socket/src/components/FileCard.tsx";
const PLAYER = "src/packages/socket/src/components/ChatMediaPlayer.tsx";

/* ── a browser small enough to watch: anchors, tabs, toasts, object URLs ─── */

const realFetch = globalThis.fetch;
const env = {
  saves: [],
  tabs: [],
  toasts: [],
  fetches: [],
  made: new Map(),
  revoked: [],
  serverAnswer: null,
};
const fakeUrl = {
  createObjectURL(blob) {
    const url = URL.createObjectURL(blob);
    env.made.set(url, blob);
    return url;
  },
  revokeObjectURL(url) {
    env.revoked.push(url);
    URL.revokeObjectURL(url);
  },
};
const fakeDocument = {
  body: { appendChild() {}, removeChild() {} },
  createElement(tag) {
    assert.equal(tag, "a");
    return {
      href: "",
      download: undefined,
      click() {
        assert.ok(!env.revoked.includes(this.href), "the object URL was revoked before the download started");
        env.saves.push({ name: this.download, blob: env.made.get(this.href), href: this.href });
      },
    };
  },
};
const recordingFetch = async (url, init) => {
  env.fetches.push({ url, init });
  if (url.startsWith("blob:")) return realFetch(url, init);
  if (!env.serverAnswer) throw new TypeError("Failed to fetch");
  return env.serverAnswer;
};
const reset = () => {
  env.saves = [];
  env.tabs = [];
  env.toasts = [];
  env.fetches = [];
  env.revoked = [];
  env.serverAnswer = null;
};

const { saveBlob, readBlobUrl, saveOpenedFile, triggerDownload } = new Function(
  "toast", "document", "window", "URL", "fetch",
  `${moduleBody(DOWNLOAD)}\nreturn { saveBlob, readBlobUrl, saveOpenedFile, triggerDownload };`,
)(
  { error: (message) => env.toasts.push(message) },
  fakeDocument,
  { open: (url) => env.tabs.push(url) },
  fakeUrl,
  recordingFetch,
);

const bytesOf = async (blob) => Array.from(new Uint8Array(await blob.arrayBuffer()));

/* ── the file an encrypted message carries, opened the way useChat opens it ─ */

const CONVERSATION = "dm_g0123456789abcdef0123456789abcdef";
const PICTURE = Uint8Array.from({ length: 4000 }, (_, i) => (i * 131 + 7) % 256);
const CLIP = Uint8Array.from({ length: 6000 }, (_, i) => (i * 29 + 3) % 256);
const picture = sealAttachment({ bytes: PICTURE, conversationId: CONVERSATION, name: "holiday photo.png", mime: "image/png" });
const clip = sealAttachment({ bytes: CLIP, conversationId: CONVERSATION, name: "clip.webm", mime: "video/webm" });
const ciphertext = { picture: picture.ciphertext, clip: clip.ciphertext };

let serverFetches = 0;
globalThis.fetch = async (url) => {
  serverFetches++;
  const bytes = ciphertext[new URL(url).pathname.split("/").pop()];
  return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};
const kept = [];
const open = (fileId, meta) =>
  openSealedAttachment({
    fileId,
    key: meta,
    fileUrl: () => `https://chat.example/api/uploads/files/${fileId}?t=A`,
    openFile: (bytes, m) => openAttachment({ ciphertext: bytes, conversationId: CONVERSATION, meta: m }),
    keepUrl: (url) => kept.push(url),
  });
const pictureMeta = await open("picture", picture.meta);
const clipMeta = await open("clip", clip.meta);
assert.notDeepEqual(Array.from(picture.ciphertext.slice(0, 64)), Array.from(PICTURE.slice(0, 64)), "the fixture is not encrypted");

/* ── Save As on an encrypted image saves the picture, named and typed as sent ─ */

{
  reset();
  // What MessageAttachment hands the menu for a file it already holds.
  await saveOpenedFile(() => readBlobUrl(pictureMeta.local_url), pictureMeta.original_name);
  assert.equal(env.saves.length, 1, "Save As did not start a download");
  const [saved] = env.saves;
  assert.equal(saved.name, "holiday photo.png", "the download lost the sender's file name");
  assert.equal(saved.blob.type, "image/png", "the download lost the sender's type");
  assert.deepEqual(await bytesOf(saved.blob), Array.from(PICTURE), "Save As saved something other than the decrypted picture");
  assert.deepEqual(env.fetches.map((f) => f.url), [pictureMeta.local_url], "Save As went to the network for a file already here");
  assert.ok(env.revoked.includes(saved.href), "the object URL made for the download is never revoked");
  assert.deepEqual([env.tabs, env.toasts], [[], []]);
}

/* ── an encrypted video decrypts on Save As, at the token current then ───── */

{
  reset();
  const before = serverFetches;
  await saveOpenedFile(clipMeta.open_sealed, clipMeta.original_name);
  assert.equal(serverFetches - before, 1, "Save As on an unplayed video should fetch it once");
  assert.equal(env.saves[0]?.name, "clip.webm");
  assert.equal(env.saves[0].blob.type, "video/webm");
  assert.deepEqual(await bytesOf(env.saves[0].blob), Array.from(CLIP), "Save As saved something other than the decrypted video");
}

/* ── a file that won't open says so, and never falls back to the server copy ─ */

{
  reset();
  await saveOpenedFile(async () => {
    throw new Error("503");
  }, "clip.webm");
  assert.deepEqual(env.saves, [], "a failed decrypt still started a download");
  assert.deepEqual(env.tabs, [], "a failed decrypt opened a tab, which could only hold ciphertext");
  assert.equal(env.toasts.length, 1, "a failed Save As happened silently");
}

/* ── a blob URL, as the lightbox has for an encrypted image, saves as it is ─ */

{
  reset();
  await triggerDownload(pictureMeta.local_url, "holiday photo.png");
  assert.deepEqual(env.fetches.map((f) => f.url), [pictureMeta.local_url], "a query string went on a blob URL, which breaks it");
  assert.deepEqual(env.tabs, [], "a blob URL was opened in a tab instead of saved");
  assert.deepEqual(await bytesOf(env.saves[0].blob), Array.from(PICTURE));

  reset();
  const gone = fakeUrl.createObjectURL(new Blob(["x"]));
  fakeUrl.revokeObjectURL(gone);
  env.revoked = [];
  await triggerDownload(gone, "gone.png");
  assert.deepEqual([env.saves, env.tabs], [[], []], "a dead blob URL started a download or a tab");
  assert.equal(env.toasts.length, 1);
}

/* ── a server copy is still fetched with download=1, and opened if that fails ─ */

{
  reset();
  env.serverAnswer = { ok: true, blob: async () => new Blob(["plain"], { type: "text/plain" }) };
  await triggerDownload("https://chat.example/api/uploads/files/f1?t=A", "notes.txt");
  assert.deepEqual(env.fetches.map((f) => f.url), ["https://chat.example/api/uploads/files/f1?t=A&download=1"]);
  assert.equal(env.saves[0]?.name, "notes.txt");

  reset();
  await triggerDownload("https://chat.example/api/uploads/files/f1", "notes.txt");
  assert.deepEqual(env.tabs, ["https://chat.example/api/uploads/files/f1?download=1"], "a failed server download no longer opens the link");
}

{
  reset();
  const png = new Blob([PICTURE], { type: "image/png" });
  saveBlob(png, null);
  assert.equal(env.saves[0].name, "", "an unnamed file should leave the name to the browser");
}

/* ── Copy Image takes the image itself when it is here ──────────────────── */

{
  const written = [];
  const copyImageToClipboard = new Function(
    "fetch", "navigator", "ClipboardItem",
    `${moduleBody(CLIPBOARD)}\nreturn copyImageToClipboard;`,
  )(
    recordingFetch,
    { clipboard: { write: async (items) => written.push(...items) } },
    class { constructor(parts) { this.parts = parts; } },
  );

  reset();
  const decrypted = await readBlobUrl(pictureMeta.local_url);
  env.fetches = [];
  await copyImageToClipboard(decrypted);
  assert.deepEqual(env.fetches, [], "Copy Image fetched something for an image it was handed");
  assert.deepEqual(await bytesOf(written[0].parts["image/png"]), Array.from(PICTURE), "Copy Image copied something other than the decrypted picture");

  reset();
  env.serverAnswer = { ok: true, blob: async () => new Blob([PICTURE], { type: "image/png" }) };
  await copyImageToClipboard("https://chat.example/api/uploads/files/f1?t=A");
  assert.equal(env.fetches[0].init?.cache, "no-store",
    "Copy Image reads the server copy from the cache again, where the <img> left it without CORS headers");
}

/* ── a played video saves the copy it played, and an unplayed one doesn't start ─ */

{
  const hookBody = moduleBody(VIDEO_HOOK);
  const readUrls = [];
  const useSealedVideo = new Function(
    "useState", "useRef", "useEffect", "useCallback", "readBlobUrl",
    `${hookBody}\nreturn useSealedVideo;`,
  );

  /** One mounted hook: state and refs by slot, effects skipped, callbacks rebuilt when deps change. */
  function mount(openVideo) {
    const slots = [];
    let slot = 0;
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const hook = useSealedVideo(
      (init) => {
        const i = slot++;
        if (!(i in slots)) slots[i] = { value: init };
        const cell = slots[i];
        return [cell.value, (next) => { cell.value = typeof next === "function" ? next(cell.value) : next; }];
      },
      (init) => {
        const i = slot++;
        if (!(i in slots)) slots[i] = { current: init };
        return slots[i];
      },
      () => { slot++; },
      (fn, deps) => {
        const i = slot++;
        if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { fn, deps };
        return slots[i].fn;
      },
      async (url) => { readUrls.push(url); return readBlobUrl(url); },
    );
    const render = () => { slot = 0; return hook(openVideo); };
    return { render };
  }

  let opens = 0;
  const openVideo = async () => { opens++; return new Blob([CLIP], { type: "video/webm" }); };
  const video = mount(openVideo);

  let now = video.render();
  const unplayed = await now.file();
  now = video.render();
  assert.equal(opens, 1, "Save As on an unplayed video did not decrypt it");
  assert.deepEqual([now.src, now.phase], [null, "idle"], "Save As started the video, which then plays itself");
  assert.deepEqual(await bytesOf(unplayed), Array.from(CLIP));

  now.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  now = video.render();
  assert.match(now.src ?? "", /^blob:/, "play never produced a blob URL");
  const played = await now.file();
  assert.equal(opens, 2, "Save As on a played video decrypted it again");
  assert.deepEqual(readUrls, [now.src], "Save As on a played video did not use the copy it played");
  assert.deepEqual(await bytesOf(played), Array.from(CLIP));
  URL.revokeObjectURL(now.src);
}

/* ── the wiring: nothing about an attachment that is here reaches the server copy ─ */

const attachment = read(ATTACHMENT);
assert.match(attachment, /const openLocal = local \? \(\) => readBlobUrl\(local\) : undefined;/,
  `${ATTACHMENT} no longer reads a file it holds from its blob URL`);
const imageMenu = attachment.match(/if \(mime\.startsWith\("image\/"\)\) \{[\s\S]*?<MessageContextMenu\s+media=\{([^\n]*)\}/)?.[1];
assert.ok(imageMenu, `${ATTACHMENT} no longer draws the image's menu`);
assert.match(imageMenu, /^openLocal \? \{ open: openLocal, fileName, isImage: true \} : \{ src: url,/,
  `${ATTACHMENT} hands the image menu the server copy for a file it holds`);
const playerMenu = attachment.match(/if \(mime\.startsWith\("audio\/"\) \|\| mime\.startsWith\("video\/"\)\) \{[\s\S]*?<MessageContextMenu media=\{([^\n]*?)\} messageActions/)?.[1];
assert.match(playerMenu ?? "", /^openLocal \? \{ open: openLocal, fileName \} : \{ src: url, fileName \}$/,
  `${ATTACHMENT} hands the audio or video menu the server copy for a file it holds`);
assert.match(attachment, /<FileCard[\s\S]*?open=\{openLocal\}[\s\S]*?\/>/, `${ATTACHMENT} no longer gives the file card the file it holds`);
assert.match(attachment, /if \(mime\.startsWith\("video\/"\) && meta\?\.open_sealed\) \{\s*return \(\s*<SealedVideoAttachment\s+open=\{meta\.open_sealed\}/,
  `${ATTACHMENT} no longer draws an unopened encrypted video through SealedVideoAttachment`);
const sealedVideo = attachment.slice(attachment.indexOf("function SealedVideoAttachment"));
assert.match(sealedVideo, /const video = useSealedVideo\(open\);/);
assert.match(sealedVideo, /<MessageContextMenu media=\{\{ open: video\.file, fileName \}\}/,
  `${ATTACHMENT}'s encrypted video menu doesn't save through the player's decrypted copy`);
assert.match(sealedVideo, /<ChatSealedVideo\s+video=\{video\}/, `${ATTACHMENT}'s menu and player hold different copies of the video`);
assert.match(read(PLAYER), /const \{ src, phase, start \} = video;/, `${PLAYER} decrypts the video itself again, apart from the menu`);

const menu = read(MENU);
assert.match(menu, /const save = "open" in media\s*\? \(\) => saveOpenedFile\(media\.open, media\.fileName\)\s*: \(\) => triggerDownload\(media\.src, media\.fileName\);/,
  `${MENU}'s Save As no longer saves the file it was handed`);
assert.match(menu, /const copyImage = "open" in media\s*\? \(\) => media\.open\(\)\.then\(copyImageToClipboard\)/,
  `${MENU}'s Copy Image no longer copies the image it was handed`);
assert.match(menu, /const src = "src" in media \? media\.src : null;/);
const branch = menu.indexOf("{src !== null && (");
assert.ok(branch > 0, `${MENU} offers links for a file whose server copy is ciphertext`);
const branchEnd = menu.indexOf("</>", branch);
for (const item of ["Copy Link", "Open in Browser"]) {
  const at = menu.indexOf(item);
  assert.ok(at > branch && at < branchEnd && menu.indexOf(item, at + 1) === -1, `${MENU} offers ${item} outside the server-copy branch`);
}

assert.match(read(FILE_CARD), /void \(open \? saveOpenedFile\(open, originalName\) : triggerDownload\(fileUrl, originalName\)\);/,
  `${FILE_CARD}'s download button no longer saves the file it was handed`);

for (const url of kept) URL.revokeObjectURL(url);
console.log("sealed save: Save As, Copy Image and the file card give the decrypted file, and nothing links to ciphertext");
