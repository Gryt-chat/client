/* eslint-env node */

/**
 * The settings search index against the settings that exist. SettingGroup logs
 * this in dev and four settings were failing it unseen (GRYT-1009).
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS = "src/packages/settings/src/components";
const INDEX = "src/packages/settings/src/hooks/settingsSearch.ts";
const SETTINGS = "src/packages/settings/src/components/settings.tsx";

/** The same derivation SettingGroup uses, so the two cannot disagree. */
function settingAnchorId(title) {
  return title
    .split(":")[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (entry.name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/* ── what the panels render ──────────────────────────────────────────────── */

const controls = [];
for (const file of sources(COMPONENTS)) {
  // settingsComponents.tsx defines the wrappers; its `title` is the prop, not
  // a setting anybody can search for.
  if (file.endsWith("settingsComponents.tsx")) continue;
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(
    /<(?:SettingGroup|ToggleSetting|SliderSetting)\b[^>]*?\btitle=(?:"([^"]+)"|\{`([^`${]+))/gs
  )) {
    controls.push({ file, title: (match[1] ?? match[2]).trim() });
  }
}

assert.ok(controls.length > 20, `only found ${controls.length} settings — the scrape is broken`);

/* ── what the index claims ───────────────────────────────────────────────── */

const indexSource = readFileSync(INDEX, "utf8");
const entries = [...indexSource.matchAll(/\{ id: "([a-z0-9-]+)"[^\n]*?\}/g)].map((m) => {
  const line = m[0];
  const field = (name) => line.match(new RegExp(`${name}: "([^"]+)"`))?.[1];
  return {
    id: m[1],
    destination: field("destination"),
    page: field("page"),
    panel: /panel: true/.test(line),
  };
});

assert.ok(entries.length > 30, `only parsed ${entries.length} index entries — the scrape is broken`);

const ids = new Set(entries.map((entry) => entry.id));

/* ── every setting is findable ───────────────────────────────────────────── */

const unfindable = controls
  .map((control) => ({ ...control, anchor: settingAnchorId(control.title) }))
  .filter((control) => !ids.has(control.anchor));

assert.deepEqual(
  unfindable.map((c) => `${c.title} (${c.anchor}) in ${c.file}`),
  [],
  "settings with no entry in SETTINGS_INDEX — search cannot reach them",
);

/* ── every entry points at a setting that exists ─────────────────────────── */

/* An anchor can arrive three ways and only the first is a literal title, so this
   direction reads generously: a missed anchor would fail CI over a reachable one. */
const anchors = new Set(controls.map((control) => settingAnchorId(control.title)));
for (const file of sources(COMPONENTS)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\blabel="([^"]+)"/g)) anchors.add(settingAnchorId(match[1]));
  for (const match of source.matchAll(/data-setting="([a-z0-9-]+)"/g)) anchors.add(match[1]);
}
const dangling = entries
  .filter((entry) => !entry.panel && !anchors.has(entry.id))
  .map((entry) => entry.id);

assert.deepEqual(
  dangling,
  [],
  "index entries whose setting is gone or renamed — a hit scrolls to nothing",
);

/* ── every entry points at a destination and page that exist ─────────────── */

/* A destination carries an icon and a page does not, which is the only thing
   telling them apart. Collapsing the two is what would let `destination: "audio"`
   pass. */
const settings = readFileSync(SETTINGS, "utf8");
const destinations = new Set();
const pages = new Set();
const declarations = [...settings.matchAll(/value: "([a-z-]+)"/g)];
for (const [i, match] of declarations.entries()) {
  const until = declarations[i + 1]?.index ?? settings.length;
  (/\bicon:/.test(settings.slice(match.index, until)) ? destinations : pages).add(match[1]);
}

assert.ok(destinations.size > 5, `only found ${destinations.size} destinations — the scrape is broken`);
assert.ok(pages.size > 5, `only found ${pages.size} pages — the scrape is broken`);

const lost = entries.filter((entry) => !destinations.has(entry.destination));
assert.deepEqual(
  lost.map((entry) => `${entry.id} -> ${entry.destination}`),
  [],
  "index entries naming a destination that does not exist",
);

const strayPages = entries.filter((entry) => entry.page && !pages.has(entry.page));
assert.deepEqual(
  strayPages.map((entry) => `${entry.id} -> ${entry.page}`),
  [],
  "index entries naming a page that does not exist",
);

console.log(
  `settings index: ${controls.length} settings, ${entries.length} entries, ` +
    `${destinations.size} destinations, ${pages.size} pages — all agree`,
);
