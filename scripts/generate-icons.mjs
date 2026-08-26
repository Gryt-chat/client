import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const rootDir = process.cwd();
/*
 * logo-square.svg, not logo.svg.
 *
 * The full frame, because these outputs are either masked by the platform or
 * shaped here. It is the only reason the square artboard still exists.
 *
 * An earlier version of this comment said "a launcher applies its own mask — a
 * squircle on macOS", and that is wrong. iOS masks, and so does an Android
 * adaptive icon. macOS, Windows and most Linux desktops do not: a macOS icon
 * looks like a squircle because the designer drew one, not because the Dock
 * cut it. Gryt shipped a hard-edged square sitting among everything else's
 * rounded rectangles until GRYT-616.
 */
const sourceSvg = path.join(rootDir, "public", "logo-square.svg");
const buildDir = path.join(rootDir, "build");
const sizesDir = path.join(buildDir, "icon-sizes");

const sizes = [16, 24, 32, 48, 64, 128, 256];

/*
 * The corner radius Windows and Linux get, on the 1024 artboard.
 *
 * 373 is read off the mark Sivert drew the rounded tile with: its straight
 * top edge runs x373 to x651, so the radius is what is left either side. That
 * is 36% of the width — much rounder than Apple's 22%, and deliberately so.
 *
 * His drawing paints the corners #414558 rather than leaving them out, which
 * is right on a Figma canvas and wrong in a file: an icon's corners have to be
 * transparent or the taskbar shows four grey notches where the rounding should
 * be. So the shape is taken and the fill is not.
 *
 * macOS does not use this. It gets its own shape below, and it does not get
 * this one because Apple's corner is a different curve at a different size.
 */
const CORNER = 373;

const ROUNDED_MASK = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">` +
    `<rect width="1024" height="1024" rx="${CORNER}" ry="${CORNER}" fill="#fff"/>` +
    `</svg>`,
);

/*
 * The square artboard with its corners taken off.
 *
 * `dest-in` keeps the source only where the mask is opaque, so the corners end
 * up genuinely transparent rather than filled with a colour that happens to
 * match whatever was behind them when the drawing was exported.
 */
async function roundedSource(size) {
  const flat = await sharp(sourceSvg)
    .resize(1024, 1024, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .composite([{ input: ROUNDED_MASK, blend: "dest-in" }])
    .png()
    .toBuffer();

  return sharp(flat).resize(size, size, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (!(await fileExists(sourceSvg))) {
  throw new Error(`Missing source icon: ${sourceSvg}`);
}

await fs.mkdir(sizesDir, { recursive: true });

const pngFiles = [];

for (const size of sizes) {
  const output = path.join(sizesDir, `icon-${size}.png`);

  await (await roundedSource(size)).png().toFile(output);

  pngFiles.push(output);
}

await (await roundedSource(1024))
  .png()
  .toFile(path.join(buildDir, "icon.png"));

const icoBuffer = await pngToIco(pngFiles);
await fs.writeFile(path.join(buildDir, "icon.ico"), icoBuffer);

/*
 * The macOS icon, which is a different shape from the other two.
 *
 * Apple's since Big Sur, on a 1024 canvas: a rounded rectangle 824 across,
 * centred, so 100px of transparent margin every side, corner radius 185.4.
 * Not a circle — the round mark is as wrong here as the square one, just
 * differently. The margin is not padding to taste; the Dock sizes every icon
 * against that 824 box, so a full-bleed square also reads too big next to its
 * neighbours, on top of having corners.
 *
 * Derived rather than drawn, so there is no fourth file to keep in step.
 */
const MAC_CANVAS = 1024;
const MAC_SHAPE = 824;
const MAC_RADIUS = 185.4;
const macInset = Math.round((MAC_CANVAS - MAC_SHAPE) / 2);

const macMask = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${MAC_SHAPE}" height="${MAC_SHAPE}">` +
    `<rect width="${MAC_SHAPE}" height="${MAC_SHAPE}" rx="${MAC_RADIUS}" ry="${MAC_RADIUS}" fill="#fff"/>` +
    `</svg>`,
);

const macShape = await sharp(sourceSvg)
  .resize(MAC_SHAPE, MAC_SHAPE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .composite([{ input: macMask, blend: "dest-in" }])
  .png()
  .toBuffer();

await sharp({
  create: {
    width: MAC_CANVAS,
    height: MAC_CANVAS,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: macShape, left: macInset, top: macInset }])
  .png()
  .toFile(path.join(buildDir, "icon-macos.png"));

console.log("Generated:");
console.log(`- ${path.relative(rootDir, path.join(buildDir, "icon.png"))}`);
console.log(`- ${path.relative(rootDir, path.join(buildDir, "icon.ico"))}`);
console.log(`- ${path.relative(rootDir, path.join(buildDir, "icon-macos.png"))}`);
