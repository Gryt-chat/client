import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const rootDir = process.cwd();
/*
 * logo-square.svg, not logo.svg.
 *
 * A launcher applies its own mask — a squircle on macOS, a rounded rect on
 * Android, whatever the theme says on Linux — so it wants the full frame.
 * Hand it the round mark and macOS draws a disc floating inside the squircle,
 * with the corners of the ground missing.
 *
 * This is the only reason the square artboard still exists as a file.
 */
const sourceSvg = path.join(rootDir, "public", "logo-square.svg");
const buildDir = path.join(rootDir, "build");
const sizesDir = path.join(buildDir, "icon-sizes");

const sizes = [16, 24, 32, 48, 64, 128, 256];

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

  await sharp(sourceSvg)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(output);

  pngFiles.push(output);
}

await sharp(sourceSvg)
  .resize(1024, 1024, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toFile(path.join(buildDir, "icon.png"));

const icoBuffer = await pngToIco(pngFiles);
await fs.writeFile(path.join(buildDir, "icon.ico"), icoBuffer);

console.log("Generated:");
console.log(`- ${path.relative(rootDir, path.join(buildDir, "icon.png"))}`);
console.log(`- ${path.relative(rootDir, path.join(buildDir, "icon.ico"))}`);
