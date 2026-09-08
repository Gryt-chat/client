import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const rootDir = process.cwd();
/*
 * logo-square.svg, not logo.svg: the full frame, because these outputs are either
 * masked by the platform or shaped here.
 */
const sourceSvg = path.join(rootDir, "public", "logo-square.svg");
const buildDir = path.join(rootDir, "build");
const sizesDir = path.join(buildDir, "icon-sizes");
const linuxIconsDir = path.join(buildDir, "icons");

const sizes = [16, 24, 32, 48, 64, 128, 256];

/*
 * The corner radius Windows and Linux get, on the 1024 artboard. 373 is read off
 * the drawn tile; its corners are #414558 there and must be transparent here.
 */
const CORNER = 373;

const ROUNDED_MASK = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">` +
    `<rect width="1024" height="1024" rx="${CORNER}" ry="${CORNER}" fill="#fff"/>` +
    `</svg>`,
);

/*
 * The square artboard with its corners taken off. `dest-in` keeps the source only
 * where the mask is opaque, so the corners end up genuinely transparent.
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

// electron-builder reads a linux icon set out of a directory keyed by the NxN.png
// name. Pointed at one PNG it ships only that; flatpak refuses above 512.
await fs.mkdir(linuxIconsDir, { recursive: true });

for (const size of [...sizes, 512]) {
  await (await roundedSource(size))
    .png()
    .toFile(path.join(linuxIconsDir, `${size}x${size}.png`));
}

/*
 * The macOS icon: Apple's shape since Big Sur, 824 across on a 1024 canvas with
 * radius 185.4. The Dock sizes against that box, so full-bleed reads too big.
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

/*
 * The MSIX tiles. Missing, electron-builder ships winCodeSign's blank samples.
 * The four names must match exactly, and no `.scale-` variants — makepri runs.
 */
const appxDir = path.join(buildDir, "appx");
await fs.mkdir(appxDir, { recursive: true });

/*
 * Square, full-bleed, same rounded shape as icon.ico. The 150 tile sits on
 * appx.backgroundColor, so its corners land on the colour they were cut from.
 */
const appxSquares = {
  "StoreLogo.png": 50,
  "Square44x44Logo.png": 44,
  "Square150x150Logo.png": 150,
};

for (const [name, size] of Object.entries(appxSquares)) {
  await (await roundedSource(size)).png().toFile(path.join(appxDir, name));
}

/*
 * The wide tile cannot be a resize: 310x150 is not the artboard's ratio, and
 * `fit: "contain"` would letterbox it out of line with the square beside it.
 */
const WIDE_WIDTH = 310;
const WIDE_HEIGHT = 150;

const wideSquare = await (await roundedSource(WIDE_HEIGHT)).png().toBuffer();

await sharp({
  create: {
    width: WIDE_WIDTH,
    height: WIDE_HEIGHT,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: wideSquare, left: Math.round((WIDE_WIDTH - WIDE_HEIGHT) / 2), top: 0 }])
  .png()
  .toFile(path.join(appxDir, "Wide310x150Logo.png"));

for (const name of [...Object.keys(appxSquares), "Wide310x150Logo.png"]) {
  console.log(`- ${path.relative(rootDir, path.join(appxDir, name))}`);
}
