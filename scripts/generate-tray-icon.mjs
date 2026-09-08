/**
 * Draws the macOS menu bar icon. A template image is alpha only, so the shape
 * carries the meaning: the bird's face is cut out and its features drawn inside.
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
 * The tray owl, on the logo's own 1024 frame. Measured off the rendered logo with
 * getBBox rather than eyeballed; re-derive that way when the mark changes.
 */
const SOLID = `<path d="M117.45 677.727C120.743 664.113 120.36 602.152 119.637 587.363C108.168 353.556 283.596 184.2 515.449 191.21C628.229 194.622 718.768 215.015 802.396 299.432C910.784 408.844 908.561 532.939 906.96 674.973C980.416 846.971 995.413 1003.44 928.604 1184.1C909.952 1234.53 867.051 1304.75 824.991 1339.24C790.453 1359.89 755.156 1380.9 714.224 1385.74C709.786 1397.93 708.22 1406.2 698.584 1414.62C671.044 1416.11 672.356 1412.41 650.517 1432.58C636.333 1434.54 635.588 1434.81 621.437 1424.16C619.727 1422.87 618.028 1421.55 616.348 1420.22C586.972 1422.33 583.755 1428.57 567.16 1401.62L461.79 1401.57C430.607 1447.05 435.866 1402.27 392.078 1431.99C375.144 1433.23 354.006 1420.75 337.187 1415.75C321.629 1411.12 319.352 1403.15 312.868 1388.28C259.874 1377.86 241.992 1355.86 203.048 1339.89C155.686 1305.18 114.107 1232 94.36 1178.04C30.9054 1004.63 43.665 843.414 117.45 677.727Z"/>`;

/*
 * The face plate, punched out of the body, with the features drawn back inside.
 * The mark's own paths, so a hand-fitted circle is not one more thing to re-fit.
 */
const FACE = `<path d="M644.863 353C728.718 353 797.231 400.641 801.761 483.172H802C802 484.836 801.984 486.498 801.956 488.16C801.985 489.397 802 490.638 802 491.882C802 500.32 801.331 508.603 800.045 516.68C796.951 543.102 790.208 569.026 779.963 593.702C765.414 628.744 744.09 660.584 717.207 687.404C690.325 714.224 658.411 735.499 623.287 750.014C588.163 764.529 550.518 772 512.5 772C474.482 772 436.837 764.529 401.713 750.014C366.589 735.499 334.675 714.224 307.793 687.404C280.91 660.584 259.586 628.744 245.037 593.702C234.792 569.026 228.048 543.103 224.955 516.681C223.668 508.604 223 500.321 223 491.882C223 490.638 223.015 489.397 223.044 488.16C223.015 486.498 223 484.836 223 483.172H223.239C227.769 400.641 296.282 353 380.137 353C435.721 353 509.197 384.119 512.5 384.119C515.803 384.119 589.279 353 644.863 353Z"/>`;

/* Eyes and beak, filled, sitting in the hole the face leaves. */
const HOLES = `
  <path d="M637.617 445.204C665.591 435.093 696.445 449.712 706.342 477.765C716.239 505.817 701.39 536.563 673.265 546.251C645.44 555.834 615.095 541.175 605.303 513.42C595.511 485.664 609.94 455.207 637.617 445.204Z"/>
  <path d="M351.43 445.189C379.259 435.201 409.911 449.686 419.866 477.529C429.817 505.372 415.293 536.009 387.442 545.929C359.639 555.83 329.07 541.337 319.137 513.545C309.2 485.75 323.652 455.159 351.43 445.189Z"/>
  <path d="M512.359 573.191C508.812 573.17 516.378 573.212 512.359 573.191C572.603 573.544 536.569 640.612 516.085 676.829C514.504 679.626 510.416 679.514 508.945 676.658C490.115 640.101 452.322 573.191 512.359 573.191Z"/>
`;

/*
 * Body, less the face, plus the features back inside it. Cutting the face is what
 * gives the silhouette an inside — it is the biggest shape in the mark.
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
 * Rasterised at high density first, then trimmed and scaled down. 288 dpi, not the
 * SVG's 512px box; height rather than a square, because the menu bar fixes height.
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
 * 1x, 2x and 3x. Electron picks the representation by name, and *Template.png is
 * treated as a template image with no explicit setTemplateImage call.
 */
await render(16, "trayTemplate.png");
await render(32, "trayTemplate@2x.png");
await render(48, "trayTemplate@3x.png");

// ── Windows and Linux voice states ──────────────────────────────────────
//
// No template mechanism on either, so these are colour discs with a glyph. A slash
// across the mark reads as "Gryt is disabled", not "your microphone is off".

const PURPLE = "#A495E3"; // the bird, straight from public/logo.svg
const INK = "#2E2D5F"; // the mark's ground, and the most legible glyph colour
                       // on every disc — 4.82:1 on the purple where white is 2.63:1
const GREEN = "#34B075";
const ROSE = "#F2555A";

// Colours are matched on *visibility*, not brightness: purple 2.30, green 2.42,
// rose 2.96 worst case, so no state looks conspicuously fainter than its neighbours.

const R = 250;
const C = 256;

/**
 * The inner markup of a phosphor glyph, scaled onto the disc. createElement rather
 * than calling the component: phosphor's are forwardRef objects and calling throws.
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
 * The bird alone, with public/logo.svg's ground stripped rather than kept as a
 * second file — two drawings of one bird drift, and this one already did once.
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
  // Not in voice: the bird itself, so the tray still identifies the app when
  // there is no call to report on. The three below keep their discs.
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
