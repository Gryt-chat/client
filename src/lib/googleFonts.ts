/**
 * Fetching a typeface a theme asked for, when this machine has agreed to. **The
 * theme says which face; this machine says whether it will go and get one.**
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
 * Letters, digits and spaces only — the name came out of a link somebody sent.
 */
function isFamilyName(value: string): boolean {
  return /^[A-Za-z0-9 ]{1,60}$/.test(value.trim());
}

/** The first family in a stack: `"Inter", ui-sans-serif` is Inter. */
function primary(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Point the document at whatever the current theme needs, or at nothing. Rewrites
 * one link element: a theme changes on every keystroke in the editor.
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
     regular, medium and semibold; the whole variable range fetches more. */
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
