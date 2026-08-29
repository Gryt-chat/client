/**
 * Fetching a typeface a theme asked for, when this machine has agreed to.
 *
 * Gryt's argument is that you host it yourself and nothing phones home, so a
 * font request to Google is not a detail — it hands them an address and a
 * picture of who is running Gryt. It happens only behind the setting in
 * Appearance, which is off until somebody turns it on.
 *
 * What is loaded is decided here rather than by the theme, and that division
 * is the point. A theme says which face it wants; this machine says whether it
 * will go and get one. If it lived in the theme, a link somebody was sent
 * could switch on network access for whoever opened it.
 *
 * Only the families a theme actually names, and only ones not already on the
 * machine. Atkinson ships with the app, so the default theme asks for nothing.
 */

/** Families that ship with Gryt or come from the OS. Never fetched. */
const LOCAL = new Set(
  [
    "Atkinson Hyperlegible Next",
    "Atkinson Hyperlegible Mono",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "system-ui",
    "sans-serif",
    "serif",
    "monospace",
    "Menlo",
    "Consolas",
    "Georgia"
  ].map((name) => name.toLowerCase())
);

const LINK_ID = "gryt-google-fonts";

/**
 * A family name Google's API will accept, and that cannot carry anything else.
 *
 * The name comes out of a theme, which came out of a link somebody was sent,
 * and goes into a URL. Letters, digits and spaces only — every family Google
 * serves is spelled that way, and anything else is somebody trying to make
 * this build a different URL than it looks like it is building.
 */
function isFamilyName(value: string): boolean {
  return /^[A-Za-z0-9 ]{1,60}$/.test(value.trim());
}

/** The first family in a stack: `"Inter", ui-sans-serif` is Inter. */
function primary(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Point the document at whatever the current theme needs, or at nothing.
 *
 * Idempotent, and rewrites one link element rather than accumulating them: a
 * theme changes on every keystroke while somebody is dragging through the
 * editor, and a stylesheet per keystroke would be a hundred requests and a
 * hundred elements.
 */
export function syncGoogleFonts(stacks: string[], enabled: boolean): void {
  const existing = document.getElementById(LINK_ID);

  if (!enabled) {
    // Removed rather than left pointing at nothing, so turning the setting off
    // stops the requests that a reload would otherwise repeat.
    existing?.remove();
    return;
  }

  const families = [
    ...new Set(
      stacks
        .map(primary)
        .filter((name) => name !== "" && !LOCAL.has(name.toLowerCase()))
        .filter(isFamilyName)
    )
  ].sort();

  if (families.length === 0) {
    existing?.remove();
    return;
  }

  /* One request for all of them. Weights 400..700 because the interface uses
     regular, medium and semibold, and asking for the whole variable range
     would fetch more than anything renders. */
  const href = `https://fonts.googleapis.com/css2?${families
    .map(
      (name) =>
        `family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400..700`
    )
    .join("&")}&display=swap`;

  const link =
    existing instanceof HTMLLinkElement
      ? existing
      : Object.assign(document.createElement("link"), {
          id: LINK_ID,
          rel: "stylesheet"
        });

  if (link.href !== href) link.href = href;
  if (link.parentNode === null) document.head.append(link);
}
