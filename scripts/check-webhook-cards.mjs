/* eslint-env node */

// Webhook cards (GRYT-1186): a fallback line is not drawn twice, file ids become upload URLs,
// and nothing on a card can count as a mention of the viewer.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const HELPERS = "src/packages/socket/src/utils/webhookCards.ts";
const ROW = "src/packages/socket/src/components/MessageRow.tsx";
const CARDS = "src/packages/socket/src/components/MessageCards.tsx";
const VIEW = "src/packages/socket/src/components/ChatView.tsx";

const { drawsMessageText, mentionsViewer, toWebhookCardData } = await import(`../${HELPERS}`);

/* ── the fallback line ──────────────────────────────────────────────────── */

assert.equal(drawsMessageText({ text: "Deploy finished" }), true);
assert.equal(drawsMessageText({ text: "Deploy finished", text_fallback: false }), true);
assert.equal(drawsMessageText({ text: "Deploy finished +1 more", text_fallback: true }), false);

const rowSource = read(ROW);
assert.match(rowSource, /drawsMessageText\(m\)/, `${ROW} no longer asks whether to draw the text`);
assert.match(
  rowSource,
  /\) : \(\s*drawsText && \(\s*<CollapsibleText>/,
  `${ROW} draws the text without checking text_fallback, so a card message shows its summary twice`,
);
assert.match(
  rowSource,
  /drawsText && \(\s*<MessageEmbeds/,
  `${ROW} unfurls links in a fallback line the row does not show`,
);
assert.match(rowSource, /<MessageCards\b/, `${ROW} no longer draws cards`);

/* ── file ids to URLs ───────────────────────────────────────────────────── */

const stored = {
  title: "Deploy finished",
  url: "https://ci.example.com/deploys/2140",
  description: "Rolled out to **eu-north**",
  color: "#3fb27f",
  author: { name: "Build runner", url: "https://ci.example.com", icon_file_id: "author-icon" },
  fields: [{ name: "Environment", value: "production", inline: true }],
  image_file_id: "graph",
  thumbnail_file_id: "thumb",
  footer: { text: "ci.example.com", icon_file_id: "footer-icon" },
  timestamp: "2026-09-15T07:42:00Z",
};
const asked = [];
const fileUrl = (fileId, kind) => {
  asked.push([fileId, kind]);
  return `http://chat.example/api/uploads/files/${fileId}?${kind === "icon" ? "thumb=1&" : ""}t=A`;
};
const data = toWebhookCardData(stored, fileUrl);

assert.equal(data.author.iconUrl, "http://chat.example/api/uploads/files/author-icon?thumb=1&t=A");
assert.equal(data.footer.iconUrl, "http://chat.example/api/uploads/files/footer-icon?thumb=1&t=A");
assert.equal(data.imageUrl, "http://chat.example/api/uploads/files/graph?t=A", "the image opens in the viewer, so no thumbnail");
assert.equal(data.thumbnailUrl, "http://chat.example/api/uploads/files/thumb?t=A");
assert.deepEqual(asked.map(([id]) => id).sort(), ["author-icon", "footer-icon", "graph", "thumb"]);
assert.equal(data.title, stored.title);
assert.equal(data.url, stored.url);
assert.equal(data.color, stored.color);
assert.deepEqual(data.fields, stored.fields);
assert.equal(data.timestamp, stored.timestamp);
for (const key of Object.keys(data)) {
  assert.ok(!key.endsWith("_file_id"), `${key} reached the component as a file id`);
}

asked.length = 0;
const minimal = toWebhookCardData({ title: "Just a title", author: { name: "Bot" }, footer: { text: "f" } }, fileUrl);
assert.equal(asked.length, 0, "a card with no pictures asked for URLs");
assert.equal(minimal.author.iconUrl, undefined);
assert.equal(minimal.footer.iconUrl, undefined);
assert.equal(minimal.imageUrl, undefined);
assert.equal(minimal.thumbnailUrl, undefined);

const cardsSource = read(CARDS);
assert.match(cardsSource, /useStableFileUrl\(/, `${CARDS} builds URLs that change on every token refresh`);
assert.match(cardsSource, /onPressImage=\{[^}]*onLightboxOpen/, `${CARDS} no longer opens card images in the viewer`);

// The installed component, drawn with those URLs and a markdown renderer that marks mentions.
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { WebhookCard } = await import("@gryt/ui");
const html = renderToStaticMarkup(
  createElement(WebhookCard, {
    card: data,
    renderMarkdown: (text) => createElement("span", { "data-markdown": "" }, text),
  }),
);
for (const url of [data.author.iconUrl, data.footer.iconUrl, data.thumbnailUrl, data.imageUrl]) {
  assert.ok(html.includes(url.replaceAll("&", "&amp;")), `@gryt/ui WebhookCard did not draw ${url}`);
}
assert.match(html, /data-markdown="">Rolled out/, "@gryt/ui WebhookCard skipped renderMarkdown for the description");
assert.match(html, /data-markdown="">production/, "@gryt/ui WebhookCard skipped renderMarkdown for field values");

/* ── mentions ───────────────────────────────────────────────────────────── */

const ME = "user-1";
const MENTION = `[@me](mention:${ME})`;

assert.equal(mentionsViewer({ text: `hi ${MENTION}` }, ME), true);
assert.equal(mentionsViewer({ text: `hi ${MENTION}` }, undefined), false);
assert.equal(mentionsViewer({ text: "hi [@them](mention:user-2)" }, ME), false);
assert.equal(mentionsViewer({ text: null }, ME), false);
assert.equal(
  mentionsViewer({ text: MENTION, text_fallback: true }, ME),
  false,
  "a server-written fallback line counted as a mention",
);
assert.equal(
  mentionsViewer(
    { text: "Deploy finished", cards: [{ description: MENTION, fields: [{ name: "who", value: MENTION, inline: false }] }] },
    ME,
  ),
  false,
  "a mention inside a card counted as a mention of the viewer",
);

const viewSource = read(VIEW);
assert.doesNotMatch(viewSource, /mention:\$\{/, `${VIEW} decides a mention without mentionsViewer`);
assert.ok((viewSource.match(/isMentioned=\{mentionsViewer\(m, currentUserId(, massViewer)?\)\}/g) ?? []).length >= 1);

// Only the row and the card component read `cards`. Anything else is a way for a card to ping.
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const readers = files(join(root, "src"))
  .filter((file) => /\.cards\b/.test(readFileSync(file, "utf8")))
  .map((file) => relative(root, file))
  .sort();
assert.deepEqual(readers, [ROW], "something other than MessageRow reads a message's cards");

/* ── who a webhook message is from ──────────────────────────────────────── */

// One webhook can post as "Build runner" and then as "Uptime check". Grouped, the second has no header.
const helpers = read("src/packages/socket/src/components/chatViewHelpers.ts");
assert.match(
  helpers,
  /isWebhook && !!prev &&\s*\(prev\.sender_nickname !== m\.sender_nickname \|\| prev\.sender_avatar_file_id !== m\.sender_avatar_file_id\)/,
  "a webhook message posted under another name is grouped under the previous one's header",
);
assert.match(helpers, /const isFirstInGroup = isSystem \|\| webhookIdentityChanged \|\|/);

/* ── the file token on first join ───────────────────────────────────────── */

// Joining from Add a server kept the access token but not the file token, so every picture broke.
const joinHook = read("src/packages/settings/src/hooks/useServerJoin.ts");
assert.match(
  joinHook,
  /if \(result\.joinInfo\.fileToken\) setServerFileToken\(normalizedHost, result\.joinInfo\.fileToken\);/,
  "useServerJoin drops the file token, so a card's pictures don't load until a rejoin",
);

console.log("webhook cards: ok");
