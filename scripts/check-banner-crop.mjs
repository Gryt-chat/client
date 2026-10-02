import assert from "node:assert/strict";

import { bannerCropGeometry, imageBytesMayAnimate } from "../src/packages/settings/src/components/bannerCrop.ts";

const wide = bannerCropGeometry(
  { width: 2000, height: 500 },
  { width: 1000, height: 400 },
  1,
  { x: 999, y: 999 },
);
assert.deepEqual(wide.position, { x: 300, y: 0 });
assert.deepEqual(wide.source, { x: 0, y: 0, width: 1250, height: 500 });

const zoomed = bannerCropGeometry(
  { width: 1000, height: 400 },
  { width: 1000, height: 400 },
  2,
  { x: -5000, y: 5000 },
);
assert.deepEqual(zoomed.position, { x: -500, y: 200 });
assert.deepEqual(zoomed.source, { x: 500, y: 0, width: 500, height: 200 });

const bytes = (value) => new TextEncoder().encode(value);
assert.equal(imageBytesMayAnimate("image/gif", bytes("GIF89a")), true);
assert.equal(imageBytesMayAnimate("image/webp", bytes("RIFFxxxxWEBPANIM")), true);
assert.equal(imageBytesMayAnimate("image/webp", bytes("RIFFxxxxWEBPVP8 ")), false);
assert.equal(imageBytesMayAnimate("image/png", bytes("PNG acTL")), true);
assert.equal(imageBytesMayAnimate("image/jpeg", bytes("jpeg")), false);

console.log("banner crop: ok");
