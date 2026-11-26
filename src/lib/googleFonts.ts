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

const LINK_CLASS = "gryt-google-fonts";

/** One family's request: weights 400..700, as the interface uses regular to semibold, or none. */
function cssUrl(name: string, weights: boolean): string {
  const family = encodeURIComponent(name).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${family}${weights ? ":wght@400..700" : ""}&display=swap`;
}

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
  const families = enabled
    ? [
        ...new Set(
          stacks
            .map(primary)
            .filter((name) => name !== "" && !LOCAL.has(name.toLowerCase()))
            .filter(isFamilyName)
        )
      ].sort()
    : [];

  // Removed rather than left pointing at nothing, so turning the setting off stops the requests.
  for (const link of document.querySelectorAll<HTMLLinkElement>(`link.${LINK_CLASS}`)) {
    if (!families.includes(link.dataset.family ?? "")) link.remove();
  }

  /* A link per family: Google answers 400 for one that doesn't cover 400..700, like Lobster,
     which used to fail every family in a shared request. That one is asked for again bare. */
  for (const name of families) {
    if (document.querySelector(`link.${LINK_CLASS}[data-family="${CSS.escape(name)}"]`)) continue;
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", className: LINK_CLASS, href: cssUrl(name, true) });
    link.dataset.family = name;
    link.addEventListener("error", () => void (link.href = cssUrl(name, false)), { once: true });
    document.head.append(link);
  }
}
