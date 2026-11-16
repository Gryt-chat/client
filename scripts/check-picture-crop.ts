// The avatar and banner crop box: where it starts, and that moving and resizing keep it inside the picture.

import assert from "node:assert/strict";

const { initialBox, moveBox, resizeBox, scaleBox } = await import("../src/packages/settings/src/components/pictureCrop.ts");

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

// A wide picture gets its full height as the avatar square, centred.
assert.deepEqual(initialBox(1200, 800, 1), { x: 200, y: 0, w: 800 });
// A tall picture gets its full width.
assert.deepEqual(initialBox(800, 1200, 1), { x: 0, y: 200, w: 800 });
// A banner on a tall picture spans the width, at the banner's shape.
const banner = 960 / 492;
const b = initialBox(900, 1400, banner);
close(b.w, 900);
close(b.y, (1400 - 900 / banner) / 2);

// Moving never leaves the picture.
assert.deepEqual(moveBox({ x: 200, y: 0, w: 800 }, 500, 500, 1200, 800, 1), { x: 400, y: 0, w: 800 });

// Pulling the bottom-right corner in shrinks it with the top-left held.
const shrunk = resizeBox({ x: 200, y: 0, w: 800 }, "se", -100, -100, 1200, 800, 1, 80);
assert.deepEqual(shrunk, { x: 200, y: 0, w: 700 });
// Pulling the top-left out is stopped by the picture's edge.
const grown = resizeBox({ x: 400, y: 100, w: 400 }, "nw", -1000, -1000, 1200, 800, 1, 80);
assert.deepEqual(grown, { x: 300, y: 0, w: 500 });
// Never smaller than the minimum.
assert.equal(resizeBox({ x: 0, y: 0, w: 200 }, "se", -500, -500, 1200, 800, 1, 80).w, 80);

// A banner keeps its shape when a corner is pulled.
const wide = resizeBox({ x: 0, y: 0, w: 600 }, "se", 120, 0, 900, 1400, banner, 50);
close(wide.w, 660);

// The keyboard grows it about its centre and stops at the largest that fits.
assert.equal(scaleBox({ x: 200, y: 0, w: 800 }, 100, 1200, 800, 1, 80).w, 800);

console.log("picture crop: ok");
