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
import { readFileSync, writeFileSync } from "fs";
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

/*
 * The tray owl, on the logo's own 1024 frame.
 *
 * Re-derived for the 2026 mark. The previous numbers were measured off the old
 * logo — a dark bird on a violet disc — and none of them survived it: the eyes
 * moved from y196 to y495 on a frame twice the size.
 *
 * Measured rather than eyeballed, by rendering the logo and reading getBBox:
 *
 *     left eye   (369.5, 495.5)  r 53.5
 *     right eye  (655.8, 495.6)  r 53.6
 *     beak        x 479.8-545.6, y 573.2-678.9
 *
 * The disc is centred at (512, 545) rather than on the face's own centre
 * (512, 562), and r=230 clears the outermost feature — the right eye's far
 * edge, 203px out — by about 26px. Centring on the face proper drops the eyes
 * too high in the circle once the head is gone.
 */
const SOLID = `<circle cx="512" cy="545" r="230"/>`;

/*
 * Punched out: both eyes and the beak, as the mark's own paths rather than
 * circles approximating them. They are already the right shape and already in
 * this coordinate space, and a hand-fitted circle is one more thing to re-fit
 * the next time the bird is redrawn.
 */
const HOLES = `
  <path d="M637.617 445.204C665.591 435.093 696.445 449.712 706.342 477.765C716.239 505.817 701.39 536.563 673.265 546.251C645.44 555.834 615.095 541.175 605.303 513.42C595.511 485.664 609.94 455.207 637.617 445.204Z"/>
  <path d="M351.43 445.189C379.259 435.201 409.911 449.686 419.866 477.529C429.817 505.372 415.293 536.009 387.442 545.929C359.639 555.83 329.07 541.337 319.137 513.545C309.2 485.75 323.652 455.159 351.43 445.189Z"/>
  <path d="M512.359 573.191C508.812 573.17 516.378 573.212 512.359 573.191C572.603 573.544 536.569 640.612 516.085 676.829C514.504 679.626 510.416 679.514 508.945 676.658C490.115 640.101 452.322 573.191 512.359 573.191Z"/>
`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <mask id="owl">
    <g fill="#fff">${SOLID}</g>
    <g fill="#000">${HOLES}</g>
  </mask>
  <rect width="1024" height="1024" fill="#000" mask="url(#owl)"/>
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

const PURPLE = "#A495E3"; // the bird, straight from public/logo.svg
const INK = "#2E2D5F"; // the mark's ground, and the most legible glyph colour
                       // on every disc — 4.82:1 on the purple where white is 2.63:1
const GREEN = "#34B075";
const ROSE = "#F2555A";

// Colours are matched on *visibility*, not brightness. Worst case against a
// Windows 11 light taskbar, a Windows 11 dark one, a GNOME dark panel and a
// KDE light one: purple 2.30, green 2.42, rose 2.96 — so no state looks
// conspicuously fainter than its neighbours. The obvious "live" green,
// #3DD68C, measures 1.63:1 on a light taskbar and the disc washes out.
//
// Re-measured for the 2026 mark. Its violet is a shade lighter than the old
// one, which costs the idle disc 0.11 against a KDE light panel — the three
// stay within 0.66 of each other, which is what the matching is for.

const R = 250;
const C = 256;

// The owl's features rescaled onto the full-size disc. They are authored
// against the r=230 disc above, centred on (512, 545), so they need moving and
// rescaling before they can sit on this one.
//
// Both numbers come off SOLID rather than being tuned here. When they did not,
// the idle disc came out blank: the features were still being re-centred on
// (256, 196) from the previous mark and landed clean outside the circle.
const K = R / 230;
const OWL_ON_DISC = `<g transform="translate(${C} ${C}) scale(${K}) translate(-512 -545)">${HOLES}</g>`;

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

/*
 * The rounded mark, read off disk rather than rebuilt here.
 *
 * public/logo.svg is the same drawing as public/logo-square.svg with a circular
 * clip, and for the idle state that is exactly what is wanted — the app's own
 * mark, in its own colours, in the shape a tray icon should be.
 *
 * This is the one state that can be the real mark. macOS cannot have it: a
 * *Template.png is read for its alpha only and painted black, so a full-colour
 * logo arrives as a solid disc. That is why the silhouette above still exists
 * and is still hand-built.
 */
const ROUND_MARK = readFileSync(
  join(__dirname, "..", "public", "logo.svg"),
  "utf8",
);

const states = {
  // Not in voice. The mark itself, so the tray still identifies the app when
  // there is no call to report on.
  "tray-idle": ROUND_MARK,
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
