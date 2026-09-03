/* eslint-env node */

/**
 * A link card takes its shape from what the page actually gave us.
 *
 * The card this replaced always reserved a picture slot and always filled it,
 * with a grey rectangle when there was no picture. A page with no `og:image`
 * came out as a hostname next to an empty box, which is what a private GitHub
 * repository looked like in chat.
 *
 * So the interesting cases are the ones where a page is missing something: no
 * image, no title, no metadata at all, an image too small to lead with. Those
 * are what this sweeps.
 */

import assert from "node:assert/strict";

import {
  describePreviewFailure,
  getLinkCardLayout,
} from "../src/packages/socket/src/components/embedUtils.ts";
import {
  getAccentColor,
  getEmbedProvider,
  getProviderDetail,
} from "../src/packages/socket/src/components/embedProviders.ts";

/** A preview with nothing set, so each case can name only what it needs. */
function preview(fields) {
  return {
    url: "https://example.com/a",
    title: null,
    description: null,
    image: null,
    imageWidth: null,
    imageHeight: null,
    siteName: null,
    favicon: null,
    ...fields,
  };
}

// ── Layout ──────────────────────────────────────────────────

assert.equal(
  getLinkCardLayout(preview({ title: "A post", image: "https://x/i.png", imageWidth: 1200, imageHeight: 630 })),
  "large",
  "a wide share card leads the card",
);

assert.equal(
  getLinkCardLayout(preview({ title: "A post", image: "https://x/i.png", imageWidth: 400, imageHeight: 400 })),
  "thumbnail",
  "a square image sits beside the text rather than under it",
);

assert.equal(
  getLinkCardLayout(preview({ title: "A post", image: "https://x/i.png", imageWidth: 120, imageHeight: 90 })),
  "thumbnail",
  "a small image is a thumbnail even though it is landscape",
);

assert.equal(
  getLinkCardLayout(preview({ title: "A post", image: "https://x/i.png" })),
  "large",
  "an image with no declared size is assumed to be a share card",
);

assert.equal(
  getLinkCardLayout(preview({ image: "https://x/i.png", imageWidth: 400, imageHeight: 400 })),
  "large",
  "with no words to sit beside, a square image leads instead of shrinking",
);

assert.equal(
  getLinkCardLayout(preview({ title: "A post", description: "Words." })),
  "text",
  "no image means no space set aside for one",
);

assert.equal(
  getLinkCardLayout(preview({})),
  "bare",
  "nothing at all is its own case, not an empty large card",
);

// ── What a failure is worth saying ──────────────────────────

assert.equal(describePreviewFailure(401), "Sign-in only");
// A 403 is as often a site refusing our fetcher as a page you may not see.
// Stack Overflow answers 403 to the preview fetch and 200 to a browser.
assert.equal(describePreviewFailure(403), "The site would not let us look");
assert.equal(describePreviewFailure(404), "Page not found");
assert.equal(describePreviewFailure(429), "The site is rate limiting us");
assert.equal(describePreviewFailure(200), null, "a page that answered fine has no failure to report");
assert.equal(describePreviewFailure(500), null, "the site being broken is not worth a line in chat");
assert.equal(describePreviewFailure(null), null);
assert.equal(describePreviewFailure(undefined), null, "an older server sends no status at all");

// ── Which site a link belongs to ────────────────────────────

assert.equal(getEmbedProvider("https://github.com/Gryt-chat/gryt")?.id, "github");
assert.equal(getEmbedProvider("https://www.github.com/Gryt-chat/gryt")?.id, "github", "www is not a different site");
assert.equal(getEmbedProvider("https://modrinth.com/mod/sodium")?.id, "modrinth");
assert.equal(getEmbedProvider("https://old.reddit.com/r/programming")?.id, "reddit");
assert.equal(getEmbedProvider("https://en.wikipedia.org/wiki/WebRTC")?.id, "wikipedia", "matched on the suffix");
assert.equal(getEmbedProvider("https://gryt.chat/")?.id, undefined, "the rest of the web is not a provider");
assert.equal(getEmbedProvider("not a url"), null, "junk does not throw");

// A hostname that merely ends with a provider's name is a different site.
assert.equal(getEmbedProvider("https://notgithub.com/x"), null);
assert.equal(getEmbedProvider("https://github.com.evil.example/x"), null);

// ── The line read out of the path ───────────────────────────

assert.equal(getProviderDetail("https://github.com/Gryt-chat/gryt"), "Gryt-chat/gryt");
assert.equal(getProviderDetail("https://github.com/Gryt-chat/gryt/pull/171"), "Gryt-chat/gryt · pull request #171");
assert.equal(getProviderDetail("https://github.com/Gryt-chat/gryt/issues/42"), "Gryt-chat/gryt · issue #42");
assert.equal(getProviderDetail("https://github.com/sivert-io"), "@sivert-io");
assert.equal(getProviderDetail("https://github.com/"), null, "the front page names no repository");

assert.equal(getProviderDetail("https://modrinth.com/mod/sodium"), "Mod · sodium");
assert.equal(getProviderDetail("https://modrinth.com/shader/complementary"), "Shader · complementary");

assert.equal(getProviderDetail("https://www.reddit.com/r/programming/"), "r/programming");
assert.equal(getProviderDetail("https://www.reddit.com/r/programming/comments/abc/title/"), "r/programming · post");
assert.equal(getProviderDetail("https://www.reddit.com/u/spez"), "u/spez");

assert.equal(getProviderDetail("https://en.wikipedia.org/wiki/Rick_Astley"), "Rick Astley");
assert.equal(
  getProviderDetail("https://en.wikipedia.org/wiki/Caf%C3%A9"),
  "Café",
  "a percent-encoded article title is decoded",
);

assert.equal(getProviderDetail("https://www.npmjs.com/package/react"), "react");
assert.equal(getProviderDetail("https://www.npmjs.com/package/@types/node"), "@types/node");

assert.equal(getProviderDetail("https://gryt.chat/"), null, "a site with no rule reads nothing out of the path");

// ── The accent a card is drawn with ─────────────────────────

assert.equal(
  getAccentColor("https://modrinth.com/mod/sodium", null, "dark"),
  "#00AF5C",
  "a known brand wins over anything the page declares",
);

assert.equal(
  getAccentColor("https://github.com/x/y", null, "dark"),
  "#8B949E",
  "a near-black brand is lifted on a dark card so the edge is visible",
);
assert.equal(getAccentColor("https://github.com/x/y", null, "light"), "#181717");

assert.equal(
  getAccentColor("https://example.com/", "#1bd96a", "dark"),
  "#1bd96a",
  "an unknown site is drawn in the colour it declares for itself",
);
assert.equal(
  getAccentColor("https://example.com/", null, "dark"),
  null,
  "and falls back to the app's own accent when it declares none",
);

// Every provider has to be usable as a colour and unique as an id.
const { EMBED_PROVIDERS } = await import(
  "../src/packages/socket/src/components/embedProviders.ts"
);
const ids = new Set();
for (const p of EMBED_PROVIDERS) {
  assert.ok(!ids.has(p.id), `duplicate provider id: ${p.id}`);
  ids.add(p.id);
  assert.match(p.brand, /^#[0-9a-fA-F]{6}$/, `${p.id} brand is not a hex colour`);
  if (p.brandDark) {
    assert.match(p.brandDark, /^#[0-9a-fA-F]{6}$/, `${p.id} brandDark is not a hex colour`);
  }
  assert.ok(p.hosts.length > 0 || p.hostSuffixes?.length, `${p.id} matches nothing`);
  assert.ok(p.Icon, `${p.id} has no icon`);
}

console.log(`embed cards: ok (${EMBED_PROVIDERS.length} providers)`);
