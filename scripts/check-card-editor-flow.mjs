import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settings = readFileSync("src/packages/settings/src/components/cardSettings.tsx", "utf8");
const card = readFileSync("src/packages/socket/src/components/MemberIdentityCard.tsx", "utf8");
const shared = readFileSync("src/lib/sharedLook.ts", "utf8");
const view = readFileSync("src/packages/socket/src/components/memberCard/MemberCardView.tsx", "utf8");

assert.match(card, /openSettings\("profile\/card\/edit"\)/);
assert.match(card, /cardBanner: member\.bannerFileId/);
assert.match(card, /member\.avatarFileId \? null : member\.avatarWorn/);
assert.match(settings, /title="Discard card changes\?"/);
assert.match(settings, /confirmLabel="Discard changes"/);
assert.match(settings, /const discardChanges = \(\) => \{[\s\S]*setDraft\(saved\);[\s\S]*setBannerPreview\(undefined\);[\s\S]*setPendingBanner\(undefined\);/);
assert.match(settings, /takeSharedLook\("cardBanner"\)/);
assert.match(shared, /cardBanner\?: string \| null/);
assert.match(settings, /accept="[^"]*video\/mp4/);
assert.match(settings, /server_info\?\.upload_max_bytes/);
assert.match(view, /fetch\(url, \{ method: "HEAD"/);
assert.match(view, /bannerType/);

console.log("card editor flow: ok");
