import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const emojiData = readFileSync("src/packages/socket/src/utils/emojiData.ts", "utf8");
const cardGroups = readFileSync("src/packages/socket/src/components/memberCard/cardEmojiGroups.ts", "utf8");
const cardSettings = readFileSync("src/packages/settings/src/components/cardSettings.tsx", "utf8");
const cardView = readFileSync("src/packages/socket/src/components/memberCard/MemberCardView.tsx", "utf8");

assert.match(emojiData, /customEmojisByServer\.set\(serverHost, next\)/);
assert.match(emojiData, /customEmojisByServer\.get\(serverHost\)/);
assert.match(cardGroups, /getCustomEmojis\(serverHost\)/);
assert.match(cardSettings, /useCardEmojiGroups\(currentlyViewingServer\?\.host\)/);
assert.match(cardView, /useCardEmojiGroups\(currentlyViewingServer\?\.host\)/);

console.log("card emoji groups: ok");
