/* eslint-env node */

/**
 * What a narrow window keeps, and what it drops: the member list used to clip out
 * of the window, and a small window is now one channel where there is a mouse.
 */

import assert from "node:assert/strict";

import {
  COMPACT_MAX_WIDTH,
  hasRoomForMemberList,
  hasRoomForVoicePanel,
  isTinyWindow,
  TINY_MAX_WIDTH,
  VOICE_PANEL_WIDTH,
} from "../src/packages/socket/src/lib/narrowLayout.ts";

/* ── Out of voice, nothing changes ─────────────────────────────────── */

// The behaviour people already know: the sidebars go at the compact
// breakpoint, and 1024 is the breakpoint.
assert.equal(hasRoomForMemberList({ windowWidth: 1025, voicePanelWidth: 0 }), true);
assert.equal(hasRoomForMemberList({ windowWidth: COMPACT_MAX_WIDTH, voicePanelWidth: 0 }), false);
assert.equal(hasRoomForMemberList({ windowWidth: 800, voicePanelWidth: 0 }), false);

/* ── In voice, the panel has to be paid for ────────────────────────── */

// The bug, stated as a number. A window that held the member list out of voice
// cannot hold it with 600px of panel in the row, and the old code said yes.
assert.equal(
  hasRoomForMemberList({ windowWidth: 1100, voicePanelWidth: VOICE_PANEL_WIDTH }),
  false,
);

// Rail 32, padding 32, three 16px gaps, two 240px sidebars, 600 voice and 200
// chat is 1392, so the old rule was wrong from 1025 to 1391.
assert.equal(
  hasRoomForMemberList({ windowWidth: 1400, voicePanelWidth: VOICE_PANEL_WIDTH }),
  true,
);
assert.equal(
  hasRoomForMemberList({ windowWidth: 1392, voicePanelWidth: VOICE_PANEL_WIDTH }),
  true,
);
assert.equal(
  hasRoomForMemberList({ windowWidth: 1391, voicePanelWidth: VOICE_PANEL_WIDTH }),
  false,
);

// A narrower panel costs less. The voice view is clamped to
// `container - MIN_CHAT_WIDTH`, so the chat's minimum has pushed the panel down.
assert.equal(hasRoomForMemberList({ windowWidth: 1200, voicePanelWidth: 400 }), true);
assert.equal(hasRoomForMemberList({ windowWidth: 1100, voicePanelWidth: 400 }), false);

// Whatever the answer, it never claims more room than the window has: the
// member panel's right edge is inside the window at every width it says yes to.
for (let w = 300; w <= 2000; w += 1) {
  for (const voice of [0, 200, 400, VOICE_PANEL_WIDTH]) {
    if (!hasRoomForMemberList({ windowWidth: w, voicePanelWidth: voice })) continue;
    const used = 32 + 32 + 16 + 240 + (voice > 0 ? 16 + voice : 0) + 200 + 16 + 240;
    assert.ok(
      used <= w,
      `member list allowed at ${w}px with a ${voice}px voice panel, needing ${used}px`,
    );
  }
}

/* ── Room for the voice panel at all ───────────────────────────────── */

// Rail, padding, channel list, the 600px panel, a 200px chat, and the 24px the
// collapsed member strip and its gap still cost: 1160.
assert.equal(hasRoomForVoicePanel(1160), true);
assert.equal(hasRoomForVoicePanel(1159), false);

// Measured before this rule existed: at 1030 the panel stayed at 600 and the chat
// was squeezed to 118px. The panel minimizes there now.
assert.equal(hasRoomForVoicePanel(1030), false);
assert.equal(hasRoomForVoicePanel(1136), false);

// Wherever the panel is allowed, the chat still gets its minimum with the
// member strip paid for.
for (let w = 300; w <= 2000; w += 1) {
  if (!hasRoomForVoicePanel(w)) continue;
  const used = 32 + 32 + 16 + 240 + 16 + 600 + 200 + 16 + 8;
  assert.ok(used <= w, `voice panel allowed at ${w}px, needing ${used}px`);
}

/* ── The tiny window ───────────────────────────────────────────────── */

// A deliberately shrunk desktop window becomes one channel.
assert.equal(isTinyWindow({ windowWidth: 400, pointerFine: true }), true);
assert.equal(isTinyWindow({ windowWidth: TINY_MAX_WIDTH, pointerFine: true }), true);
assert.equal(isTinyWindow({ windowWidth: TINY_MAX_WIDTH + 1, pointerFine: true }), false);

// Electron will not go below 300, so that is the narrowest this has to work at.
assert.equal(isTinyWindow({ windowWidth: 300, pointerFine: true }), true);

// A phone is under the threshold and must never get this. It keeps the phone
// layout, which has a way back to another channel.
assert.equal(isTinyWindow({ windowWidth: 390, pointerFine: false }), false);
assert.equal(isTinyWindow({ windowWidth: 320, pointerFine: false }), false);

// The two modes do not overlap: anything tiny enough to be one channel is far
// past the point where the member list was already gone.
for (let w = 300; w <= TINY_MAX_WIDTH; w += 1) {
  assert.equal(
    hasRoomForMemberList({ windowWidth: w, voicePanelWidth: 0 }),
    false,
    `member list allowed at ${w}px, which is inside the tiny window`,
  );
}

console.log("narrow layout ok: member list yields to the voice panel, tiny window is desktop-only");
