/**
 * Draws the macOS menu bar icon.
 *
 * A macOS template image is alpha only — the system throws the colours away and
 * paints the shape black on a light menu bar, white on a dark one. The tray was
 * being built from build/icon.png, which is the app icon: a fully opaque rounded
 * square. Every pixel is opaque, so every pixel got painted, and the menu bar
 * showed a solid black tile.
 *
 * So the shape has to carry the meaning: the bird's outline with its face
 * cut out and the eyes and beak drawn back inside the hole. That is the app
 * icon's own construction — dark body, light face, dark features — with
 * "light" meaning absent, which is the only thing a template image can say.
 *
 * Four styles were built and looked at before this one, at both sizes, painted
 * black on a light bar and white on a dark one the way macOS does:
 *
 *   - a plain disc with the features punched out. What this replaces. Legible,
 *     and not identifiably an owl.
 *   - the head outline. Tried once before and rejected then too: at 16px it
 *     read as a lump with two dents.
 *   - the body filled, features punched. The features are small against the
 *     whole bird and close up at 1x.
 *   - the body as a stroked outline, at two weights. The cleanest of them and
 *     the most like everything else in a menu bar, which is also the argument
 *     against it.
 *
 * Cutting the face wins because the face is the biggest shape in the mark, so
 * the silhouette gets an inside at any size, and because it is the drawing
 * rather than an interpretation of it.
 *
 * The full body was tried too, unclipped to y1434. The menu bar fixes an
 * icon's height and takes whatever width follows, so an unclipped bird comes
 * out narrow and its face shrinks to specks. The square-clipped mark is wider
 * for the same height, which is what keeps the features readable.
 *
 * Geometry is lifted from public/logo.svg. Run by hand, `yarn generate:tray`,
 * and commit the PNGs — same arrangement as the site's share cards.
 */
import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Microphone,
  MicrophoneSlash,
  SpeakerSlash,
} from "@phosphor-icons/react";

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
const SOLID = `<path d="M117.45 677.727C120.743 664.113 120.36 602.152 119.637 587.363C108.168 353.556 283.596 184.2 515.449 191.21C628.229 194.622 718.768 215.015 802.396 299.432C910.784 408.844 908.561 532.939 906.96 674.973C980.416 846.971 995.413 1003.44 928.604 1184.1C909.952 1234.53 867.051 1304.75 824.991 1339.24C790.453 1359.89 755.156 1380.9 714.224 1385.74C709.786 1397.93 708.22 1406.2 698.584 1414.62C671.044 1416.11 672.356 1412.41 650.517 1432.58C636.333 1434.54 635.588 1434.81 621.437 1424.16C619.727 1422.87 618.028 1421.55 616.348 1420.22C586.972 1422.33 583.755 1428.57 567.16 1401.62L461.79 1401.57C430.607 1447.05 435.866 1402.27 392.078 1431.99C375.144 1433.23 354.006 1420.75 337.187 1415.75C321.629 1411.12 319.352 1403.15 312.868 1388.28C259.874 1377.86 241.992 1355.86 203.048 1339.89C155.686 1305.18 114.107 1232 94.36 1178.04C30.9054 1004.63 43.665 843.414 117.45 677.727Z"/>`;

/*
 * The face plate, punched out of the body, and the features drawn back inside
 * it. The mark's own paths rather than shapes approximating them: they are
 * already right and already in this coordinate space, and a hand-fitted circle
 * is one more thing to re-fit the next time the bird is redrawn.
 */
const FACE = `<path d="M644.863 353C728.718 353 797.231 400.641 801.761 483.172H802C802 484.836 801.984 486.498 801.956 488.16C801.985 489.397 802 490.638 802 491.882C802 500.32 801.331 508.603 800.045 516.68C796.951 543.102 790.208 569.026 779.963 593.702C765.414 628.744 744.09 660.584 717.207 687.404C690.325 714.224 658.411 735.499 623.287 750.014C588.163 764.529 550.518 772 512.5 772C474.482 772 436.837 764.529 401.713 750.014C366.589 735.499 334.675 714.224 307.793 687.404C280.91 660.584 259.586 628.744 245.037 593.702C234.792 569.026 228.048 543.103 224.955 516.681C223.668 508.604 223 500.321 223 491.882C223 490.638 223.015 489.397 223.044 488.16C223.015 486.498 223 484.836 223 483.172H223.239C227.769 400.641 296.282 353 380.137 353C435.721 353 509.197 384.119 512.5 384.119C515.803 384.119 589.279 353 644.863 353Z"/>`;

/*
 * Eyes and beak, filled, sitting in the hole the face leaves.
 */
const HOLES = `
  <path d="M637.617 445.204C665.591 435.093 696.445 449.712 706.342 477.765C716.239 505.817 701.39 536.563 673.265 546.251C645.44 555.834 615.095 541.175 605.303 513.42C595.511 485.664 609.94 455.207 637.617 445.204Z"/>
  <path d="M351.43 445.189C379.259 435.201 409.911 449.686 419.866 477.529C429.817 505.372 415.293 536.009 387.442 545.929C359.639 555.83 329.07 541.337 319.137 513.545C309.2 485.75 323.652 455.159 351.43 445.189Z"/>
  <path d="M512.359 573.191C508.812 573.17 516.378 573.212 512.359 573.191C572.603 573.544 536.569 640.612 516.085 676.829C514.504 679.626 510.416 679.514 508.945 676.658C490.115 640.101 452.322 573.191 512.359 573.191Z"/>
`;

/*
 * Body, less the face, plus the features back inside it.
 *
 * The same three tones the app icon is built from — dark body, light face,
 * dark eyes and beak — with "light" meaning absent rather than a colour, which
 * is all a template image can say. That is what makes this read as the mark
 * rather than as a bird-shaped blob: the face is the biggest shape in it, and
 * cutting it is what gives the silhouette an inside.
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <mask id="owl">
    <g fill="#fff">${SOLID}</g>
    <g fill="#000">${FACE}</g>
  </mask>
  <rect width="1024" height="1024" fill="#000" mask="url(#owl)"/>
  <g fill="#000">${HOLES}</g>
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

/**
 * The inner markup of a phosphor glyph, scaled onto the disc.
 *
 * Rendered through react-dom rather than by reaching into the package's own
 * files: the components are the supported interface, and a build script that
 * parses node_modules breaks silently the first time the package changes shape.
 *
 * `frac` is the glyph's size as a fraction of the disc diameter. Kept well
 * under 1 — a glyph that touches the disc edge reads as clipped once it is
 * 16px, because antialiasing eats the last pixel of both.
 *
 * The weight is a prop rather than part of the name. These came from
 * react-icons, where PiMicrophoneFill was its own component; phosphor has one
 * component per icon and picks the weight at render. createElement rather than
 * calling the component, because phosphor's are forwardRef objects and calling
 * one throws.
 */
function glyph(Icon, frac) {
  const markup = renderToStaticMarkup(createElement(Icon, { weight: "fill" }));
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
 * The bird alone, read off disk rather than rebuilt here.
 *
 * public/logo.svg is the mark on its ground: a #2E2D5F plate with the owl on
 * top. The plate is what makes it an app icon, and it is the wrong half here —
 * a tray icon sits on somebody's taskbar, not on a tile, and the plate reads
 * as a sticker stuck over it.
 *
 * So the ground comes off and the owl is what is left. Stripped rather than
 * kept as a second file, because two drawings of one bird drift and this one
 * already went wrong that way once (the site's share cards carried the owl's
 * path data inline and served the old bird for a month after it changed).
 *
 * This is the one state that can be the real mark. macOS cannot have it: a
 * *Template.png is read for its alpha only and painted black, so a full-colour
 * logo arrives as a solid shape. That is why the silhouette above still exists
 * and is still hand-built.
 */
const GROUND = /<rect[^>]*fill="#2E2D5F"[^>]*\/>/;

const MARK_SOURCE = readFileSync(
  join(__dirname, "..", "public", "logo.svg"),
  "utf8",
);

if (!GROUND.test(MARK_SOURCE)) {
  throw new Error(
    "public/logo.svg has no #2E2D5F ground rect to strip. It was redrawn, and " +
      "the tray icon needs looking at rather than silently shipping the plate.",
  );
}

const MARK = MARK_SOURCE.replace(GROUND, "");

const states = {
  // Not in voice. The bird itself, so the tray still identifies the app when
  // there is no call to report on. The three below keep their discs: they are
  // reporting a state, and mass survives a taskbar at contrast a thin shape
  // does not.
  "tray-idle": MARK,
  // In voice with the microphone open. Not driven by voice activity — that
  // would flip the icon several times a second through one sentence.
  "tray-live": disc(GREEN, glyph(Microphone, 0.56)),
  "tray-muted": disc(ROSE, glyph(MicrophoneSlash, 0.62)),
  // Deafening also mutes, so this one wins when both are true: it is the more
  // complete statement of what is happening.
  "tray-deafened": disc(ROSE, glyph(SpeakerSlash, 0.62)),
};

for (const [name, source] of Object.entries(states)) {
  await render(16, `${name}.png`, source);
  await render(32, `${name}@2x.png`, source);
}

console.log("Done.");
