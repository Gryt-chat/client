import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync("src/packages/settings/src/components/cardSettings.tsx", "utf8");
const card = readFileSync("src/packages/socket/src/components/MemberIdentityCard.tsx", "utf8");
const shared = readFileSync("src/lib/sharedLook.ts", "utf8");

assert.match(card, /openSettings\("profile\/card\/edit"\)/);
assert.match(card, /cardBanner: member\.bannerFileId/);
assert.match(card, /member\.avatarFileId \? null : member\.avatarWorn/);
assert.match(settings, /title="Discard card changes\?"/);
assert.match(settings, /confirmLabel="Discard changes"/);
assert.match(settings, /const discardChanges = \(\) => \{[\s\S]*setDraft\(saved\);[\s\S]*setBannerPreview\(undefined\);[\s\S]*setPendingBanner\(undefined\);/);
assert.match(settings, /takeSharedLook\("cardBanner"\)/);
assert.match(shared, /cardBanner\?: string \| null/);

console.log("card editor flow: ok");
