/* eslint-env node */

// An attachment's URL carries the file token, which changes on every refresh. The URL has to
// stay put while the attachment is mounted, and a video must not load until clicked. GRYT-1166.

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
for (const wire of ["onError={local ? undefined : refreshUrl}", "onPosterError={refreshThumb}", "onStart={local ? undefined : refreshUrl}"]) {
  assert.ok(attachment.includes(wire), `${ATTACHMENT} lost ${wire}, so a stale token never recovers`);
}

/* ── nothing loads a video before the click ─────────────────────────────── */

/** The JSX of `<tag ... />`, from the tag to its self-closing end. */
function elements(source, tag) {
  return [...source.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?/>`, "g"))].map((m) => ({ at: m.index, jsx: m[0] }));
}

const player = read(PLAYER);
const videos = elements(player, "video");
assert.equal(videos.length, 1, `${PLAYER} should draw exactly one <video>`);
const gate = player.lastIndexOf("{started ? (", videos[0].at);
assert.ok(
  gate !== -1 && !player.slice(gate, videos[0].at).includes(") : ("),
  `${PLAYER} renders <video> outside the started branch, so it loads before anybody clicks`,
);
assert.match(player, /const \[started, setStarted\] = useState\(false\)/, `${PLAYER} starts a video already loaded`);
assert.doesNotMatch(player, /preload="auto"/, `${PLAYER} preloads whole files again`);
const audio = elements(player, "audio");
assert.equal(audio.length, 1);
assert.match(audio[0].jsx, /preload="metadata"/, `${PLAYER}'s audio preload changed. "none" leaves no duration shown.`);

const poster = player.slice(player.indexOf("export const VideoPoster"), player.indexOf("export const ChatMediaPlayer"));
assert.doesNotMatch(poster, /<video/, `${PLAYER}'s VideoPoster draws a <video>`);

const embeds = read(EMBEDS);
const embed = embeds.slice(embeds.indexOf("export const VideoEmbed"), embeds.indexOf("export const TwitchEmbed"));
assert.ok(embed.length > 0, `${EMBEDS} no longer has VideoEmbed`);
const embedVideo = elements(embed, "video");
assert.equal(embedVideo.length, 1, `${EMBEDS}'s VideoEmbed should draw exactly one <video>`);
assert.ok(
  embed.lastIndexOf("{started ? (", embedVideo[0].at) !== -1,
  `${EMBEDS}'s VideoEmbed loads the linked video before anybody clicks`,
);

console.log("stable attachment URLs: ok");
