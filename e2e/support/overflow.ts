import type { Locator } from "@playwright/test";

export interface Overflow {
  /** Elements whose visible part ends past the page column, and by how much. */
  pastEdge: string[];
  /** Containers between the page and the column that scroll sideways. */
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
 * The GRYT-1199 measurement: every element's right edge against the page column,
 * and nothing in between allowed to scroll sideways. Clipped parts don't count.
 */
export function measureOverflow(panel: Locator): Promise<Overflow> {
  return panel.evaluate((root) => {
    const describe = (el: Element) => {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const label = el.getAttribute("aria-label") ?? el.getAttribute("placeholder");
      return `<${el.tagName.toLowerCase()}>${label ? ` [${label}]` : ""}${text ? ` "${text}"` : ""}`;
    };
    const clips = (el: Element) => getComputedStyle(el).overflowX !== "visible";
    const scrolls = (el: Element) => ["auto", "scroll"].includes(getComputedStyle(el).overflowX);
    const formControl = (el: Element) => el.matches("input, textarea, select");

    let column = root.parentElement;
    while (column && column !== document.body && !scrolls(column)) column = column.parentElement;
    if (!column || column === document.body) throw new Error("no scrolling page column around the tab panel");
    const edge = column.getBoundingClientRect();

    const pastEdge: string[] = [];
    const scrollsSideways: string[] = [];
    for (const el of [column, ...root.querySelectorAll("*")]) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (scrolls(el) && !formControl(el) && el.scrollWidth > el.clientWidth + 1) {
        scrollsSideways.push(`${describe(el)} by ${el.scrollWidth - el.clientWidth}px`);
      }
      if (el === column) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      let right = rect.right;
      let left = rect.left;
      for (let up: Element | null = el.parentElement; up && up !== column; up = up.parentElement) {
        if (!clips(up)) continue;
        const box = up.getBoundingClientRect();
        right = Math.min(right, box.right);
        left = Math.max(left, box.left);
      }
      if (right <= left) continue;
      const over = Math.max(right - edge.right, edge.left - left);
      if (over > 1) pastEdge.push(`${describe(el)} by ${Math.round(over)}px`);
    }
    return { pastEdge, scrollsSideways };
  });
}
