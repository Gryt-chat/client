import type { Locator } from "@playwright/test";

export interface Overflow {
  /** Elements whose visible part ends past the dialog's edge, and by how much. */
  pastEdge: string[];
  /** Containers inside the dialog that scroll sideways. */
  scrollsSideways: string[];
}

/** Tabs slide in and out, and a page measured mid-slide reads a few hundred pixels off. */
export async function settled(scope: Locator) {
  await scope.evaluate(
    (root) =>
      new Promise<void>((resolve) => {
        const busy = () =>
          root.querySelector("[data-starting-style], [data-ending-style]") ||
          root.getAnimations({ subtree: true }).some((a) => {
            const end = a.effect?.getComputedTiming().endTime;
            return a.playState === "running" && end !== Infinity;
          });
        const check = () => (busy() ? requestAnimationFrame(check) : resolve());
        check();
      }),
  );
}

/**
 * GRYT-1199's measurement: every element's right edge against the dialog, from `scope`
 * up to it, and nothing inside allowed to scroll sideways. `scope` can be the dialog itself.
 */
export function measureOverflow(scope: Locator): Promise<Overflow> {
  return scope.evaluate((root) => {
    const describe = (el: Element) => {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const label = el.getAttribute("aria-label") ?? el.getAttribute("placeholder");
      return `<${el.tagName.toLowerCase()}>${label ? ` [${label}]` : ""}${text ? ` "${text}"` : ""}`;
    };
    const clips = (el: Element) => getComputedStyle(el).overflowX !== "visible";
    const scrolls = (el: Element) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX);

    const dialog = root.closest('[role="dialog"]');
    if (!dialog) throw new Error("what was measured is not inside a dialog");
    const box = dialog.getBoundingClientRect();
    const edge = { left: box.left + dialog.clientLeft, right: box.left + dialog.clientLeft + dialog.clientWidth };

    // `scope` and its ancestors below the dialog, outermost first. None when `scope` is the dialog.
    const between: Element[] = [];
    for (let up: Element | null = root; up && up !== dialog; up = up.parentElement) between.unshift(up);

    const pastEdge: string[] = [];
    const scrollsSideways: string[] = [];
    const flagged = new Set<Element>();
    for (const el of [dialog, ...between, ...root.querySelectorAll("*")]) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (scrolls(el) && !el.matches("input, textarea, select") && el.scrollWidth > el.clientWidth + 1) {
        scrollsSideways.push(`${describe(el)} by ${el.scrollWidth - el.clientWidth}px`);
      }
      if (el === dialog) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      let right = rect.right;
      let left = rect.left;
      for (let up: Element | null = el.parentElement; up && up !== dialog; up = up.parentElement) {
        if (!clips(up)) continue;
        const clip = up.getBoundingClientRect();
        right = Math.min(right, clip.right);
        left = Math.max(left, clip.left);
      }
      if (right <= left) continue;
      const over = Math.max(right - edge.right, edge.left - left);
      if (over <= 1) continue;
      flagged.add(el);
      // The outermost offender is the one to fix, and its children would bury it.
      if (!el.parentElement || !flagged.has(el.parentElement)) pastEdge.push(`${describe(el)} by ${Math.round(over)}px`);
    }
    return { pastEdge, scrollsSideways };
  });
}
