/* eslint-env node */

/** GRYT-1461. Parsing a stored mention into edit-box segments and
    reserializing them unchanged must give back the exact same bytes. */

import assert from "node:assert/strict";

const { parseEditSegments, reserializeEditSegments } = await import(
  "../src/packages/socket/src/utils/chatEditorMentions.ts"
);

const channels = { chan_a: "general" };
const channelName = (id, host) => (host ? null : channels[id] ?? null);

function roundTrip(text) {
  return reserializeEditSegments(parseEditSegments(text, channelName));
}

const cases = [
  "Hey [@Willow](mention:user_7c48), got a sec?",
  "[@Crew](role:crew) standup now",
  "[@everyone](mention:everyone) standup in 5",
  "[@here](mention:here) anyone around?",
  "go to [#channel](channel:chan_a) now",
  "see [#channel](channel:chan_z) instead",
  "see [#channel](channel:gryt.example.com/chan_ab12)",
  "[@Ada](mention:user_1) and [@everyone](mention:everyone) in [#channel](channel:chan_a)",
  "no mentions here at all",
  "a code span keeps `[@Willow](mention:user_7c48)` as text",
];

for (const text of cases) {
  assert.equal(roundTrip(text), text, text);
}

// A channel this viewer can see shows its name; one it can't shows the same
// placeholder the message view uses, and both still round-trip.
{
  const segments = parseEditSegments("go to [#channel](channel:chan_a) now", channelName);
  const pill = segments.find((s) => "pill" in s);
  assert.equal(pill.pill.text, "#general");
}
{
  const segments = parseEditSegments("go to [#channel](channel:chan_z) now", channelName);
  const pill = segments.find((s) => "pill" in s);
  assert.equal(pill.pill.text, "#private-channel");
}

// Editing text around a mention keeps the mention's own segment untouched.
{
  const original = "ping [@Willow](mention:user_7c48) about the release";
  const segments = parseEditSegments(original, channelName);
  const mentionIndex = segments.findIndex((s) => "pill" in s);
  assert.ok(mentionIndex > 0, "mention should not be the first segment");

  segments[0] = { text: "please " + segments[0].text };
  segments[segments.length - 1] = { text: segments[segments.length - 1].text + " today" };

  const edited = reserializeEditSegments(segments);
  assert.equal(
    edited,
    "please ping [@Willow](mention:user_7c48) about the release today",
  );
}

console.log("edit mentions: ok");
