/* eslint-env node */

/**
 * Every site `@gryt/core` knows by name has a logo in this app.
 *
 * The layout rules, the hostname matching and the path rules used to be checked
 * here. They moved to the package, where they are tested once for both apps
 * rather than twice. What is left is the seam: the package owns the provider
 * list, this app owns the artwork, and the two can drift apart without anything
 * failing to compile.
 *
 * Drifting is not fatal. A provider with no icon falls back to the site's own
 * favicon, the same as every site outside the list. It is still worth knowing,
 * because drawing the logo is the reason to name a site at all.
 */

import assert from "node:assert/strict";

import { LINK_PROVIDERS } from "@gryt/core";

import { PROVIDER_ICONS } from "../src/packages/socket/src/components/embedProviderIcons.ts";

const known = new Set(LINK_PROVIDERS.map((p) => p.id));
const drawn = new Set(Object.keys(PROVIDER_ICONS));

const missing = [...known].filter((id) => !drawn.has(id));
const orphaned = [...drawn].filter((id) => !known.has(id));

assert.deepEqual(missing, [], `providers in @gryt/core with no icon here: ${missing.join(", ")}`);

// An icon for a provider the package dropped is dead weight, and a typo in an
// id looks exactly like one.
assert.deepEqual(
  orphaned,
  [],
  `icons for providers @gryt/core does not have: ${orphaned.join(", ")}`,
);

console.log(`embed icons: ok (${known.size} providers, all drawn)`);
