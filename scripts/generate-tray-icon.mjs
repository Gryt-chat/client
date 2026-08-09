/**
 * Draws the macOS menu bar icon.
 *
 * A macOS template image is alpha only — the system throws the colours away and
 * paints the shape black on a light menu bar, white on a dark one. The tray was
 * being built from build/icon.png, which is the app icon: a fully opaque rounded
 * square. Every pixel is opaque, so every pixel got painted, and the menu bar
 * showed a solid black tile.
 *
 * So the shape has to carry the meaning: a filled disc with the eyes and beak
 * cut out of it. The holes are the whole design — they are what stops it being
 * the black tile it was, and they keep the round mark the app icon already uses
 * rather than inventing a second silhouette for the menu bar.
 *
 * A version using the owl's head outline was tried first. It is more literally
 * an owl, and at 16px it read as a lump with two dents.
 *
 * Geometry is lifted from public/logo.svg. Run by hand, `yarn generate:tray`,
 * and commit the PNGs — same arrangement as the site's share cards.
 */
import sharp from "sharp";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PiMicrophoneFill,
  PiMicrophoneSlashFill,
  PiSpeakerSlashFill,
} from "react-icons/pi";

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, "..", "build");

// The disc. Centred on the face rather than on the logo, and sized so the eyes
// and beak sit inside it with a margin — the logo's own circle is centred lower
// and would push the features off-centre once the head is gone.
const SOLID = `<circle cx="256" cy="196" r="118"/>`;

// Punched out: beak and both eyes.
const HOLES = `
  <path d="M258.736 232.014C258.214 234.003 255.389 234.003 254.867 232.014L247.045 202.207C246.712 200.939 247.669 199.7 248.98 199.7L264.624 199.7C265.935 199.7 266.891 200.939 266.558 202.207L258.736 232.014Z"/>
  <path d="M203.08 162C216.959 162 221.986 169.702 222.773 173.951C223.299 177.67 223.246 186.062 218.835 189.887C213.321 194.667 195.473 200.325 190.476 185.106C186.814 173.951 188.375 169.171 188.113 169.171C190.476 163.631 195.256 162 203.08 162Z"/>
  <path d="M308.124 160.851C294.151 160.851 289.09 168.637 288.297 172.932C287.768 176.691 287.821 185.174 292.262 189.04C297.814 193.873 315.782 199.592 320.813 184.208C324.5 172.932 322.928 168.1 323.192 168.1C320.813 162.5 316 160.851 308.124 160.851Z"/>
`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <mask id="owl">
    <g fill="#fff">${SOLID}</g>
    <g fill="#000">${HOLES}</g>
  </mask>
  <rect width="512" height="512" fill="#000" mask="url(#owl)"/>
</svg>`;

/**
 * Rasterised at high density first, then trimmed and scaled down.
 *
 * density, not the SVG's own 512px box. sharp rasterises an SVG at its declared
 * size unless told otherwise, so scaling a 512px raster down to 16 threw away
 * most of the curve information before the resample ever ran. 288 dpi puts the
 * intermediate at 2048px — 128x the 16px output, so the downscale has plenty to
 * average from, and well under sharp's pixel limit, which a higher density
 * trips outright.
 *
 * Height, not a square. The menu bar gives an icon a fixed height and takes
 * whatever width it needs, so padding out to a square would just letterbox the
 * shape and render it smaller than everything beside it.
 */
async function render(height, file, source = svg) {
  const png = await sharp(Buffer.from(source), { density: 288 })
    .trim()
    .resize({
      height,
      fit: "contain",
      kernel: "lanczos3",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const { width } = await sharp(png).metadata();
  writeFileSync(join(buildDir, file), png);
  console.log(`  build/${file}  ${width}x${height}`);
}

/**
 * 1x, 2x and 3x.
 *
 * Electron picks the representation matching the display when the files sit
 * beside each other with these names, and a *Template.png is treated as a
 * template image without an explicit setTemplateImage call.
 *
 * @3x is not used by any Mac menu bar today — macOS tops out at 2x — but it
 * costs a few hundred bytes, and it means a display that does want it has
 * something better to reach for than an upscaled 32px.
 */
await render(16, "trayTemplate.png");
await render(32, "trayTemplate@2x.png");
await render(48, "trayTemplate@3x.png");

// ── Windows and Linux voice states ──────────────────────────────────────
//
// Windows and Linux have no template mechanism, so these are colour assets.
// Each state is a filled disc with its glyph in the logo's own ink — the same
// construction as the logo itself, which is what makes the four read as one
// family rather than four unrelated icons.
//
// The disc is doing the work. A disc is mass and a glyph is detail, and mass
// stays identifiable against a taskbar at contrast a thin glyph cannot
// survive. That is what allows the real brand purple here: the glyph only has
// to out-contrast the disc, not the unknown surface behind it.
//
// A slash across the *mark* was tried first and rejected. A prohibition sign
// applies to whatever it is drawn on, so slashing the owl reads as "Gryt is
// disabled" rather than "your microphone is off". It works in the app only
// because the slash there is drawn on a microphone.

const PURPLE = "#968FF8"; // straight from public/logo.svg
const INK = "#1A1D24"; // the logo's dark, and the most legible glyph colour
                       // on every disc — 6.09:1 on the purple where white is 2.77:1
const GREEN = "#34B075";
const ROSE = "#F2555A";

// Colours are matched on *visibility*, not brightness. Worst case against a
// Windows 11 light taskbar, a Windows 11 dark one, a GNOME dark panel and a
// KDE light one: purple 2.41, green 2.40, rose 2.94 — so no state looks
// conspicuously fainter than its neighbours. The obvious "live" green,
// #3DD68C, measures 1.63:1 on a light taskbar and the disc washes out.

const R = 250;
const C = 256;

// The owl's features rescaled onto the full-size disc. They are authored
// against the r=118 disc above, so they need moving before they can sit on
// this one.
const K = R / 118;
const OWL_ON_DISC = `<g transform="translate(${C} ${C}) scale(${K}) translate(-256 -196)">${HOLES}</g>`;

/**
 * The inner markup of a react-icons glyph, scaled onto the disc.
 *
 * Rendered through react-dom rather than by reaching into the package's own
 * files: the components are the supported interface, and a build script that
 * parses node_modules breaks silently the first time the package changes shape.
 *
 * `frac` is the glyph's size as a fraction of the disc diameter. Kept well
 * under 1 — a glyph that touches the disc edge reads as clipped once it is
 * 16px, because antialiasing eats the last pixel of both.
 */
function glyph(Icon, frac) {
  const markup = renderToStaticMarkup(Icon({}));
  const inner = markup.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const size = R * 2 * frac;
  const scale = size / 256; // every Phosphor icon is authored in a 256 box
  return `<g transform="translate(${C - size / 2} ${C - size / 2}) scale(${scale})" fill="${INK}">${inner}</g>`;
}

function disc(fill, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <circle cx="${C}" cy="${C}" r="${R}" fill="${fill}"/>
  <g fill="${INK}">${inner}</g>
</svg>`;
}

const states = {
  // Not in voice. The mark itself, so the tray still identifies the app when
  // there is no call to report on.
  "tray-idle": disc(PURPLE, OWL_ON_DISC),
  // In voice with the microphone open. Not driven by voice activity — that
  // would flip the icon several times a second through one sentence.
  "tray-live": disc(GREEN, glyph(PiMicrophoneFill, 0.56)),
  "tray-muted": disc(ROSE, glyph(PiMicrophoneSlashFill, 0.62)),
  // Deafening also mutes, so this one wins when both are true: it is the more
  // complete statement of what is happening.
  "tray-deafened": disc(ROSE, glyph(PiSpeakerSlashFill, 0.62)),
};

for (const [name, source] of Object.entries(states)) {
  await render(16, `${name}.png`, source);
  await render(32, `${name}@2x.png`, source);
}

console.log("Done.");
