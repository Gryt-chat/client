import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

import { PiArrowDownBold, PiArrowUpBold } from "../../../../lib/icons";

/** Off-screen activity on one side: null for none, 0 for unread only, otherwise the mentions. */
type Waiting = number | null;

const FADE_PX = 48;

function rowsOn(scroller: HTMLElement, side: "above" | "below"): HTMLElement[] {
  const box = scroller.getBoundingClientRect();
  const rows = [...scroller.querySelectorAll<HTMLElement>("[data-activity]")].filter((row) => {
    const rect = row.getBoundingClientRect();
    const middle = rect.top + rect.height / 2;
    return rect.height > 0 && (side === "above" ? middle < box.top : middle > box.bottom);
  });
  return side === "above" ? rows.reverse() : rows;
}

const mentionsIn = (row: HTMLElement) => Number(row.dataset.activity);

function measure(scroller: HTMLElement, side: "above" | "below"): Waiting {
  const rows = rowsOn(scroller, side);
  return rows.length === 0 ? null : rows.reduce((sum, row) => sum + mentionsIn(row), 0);
}

function Pill({ side, waiting, iconsOnly, scroller }: {
  side: "above" | "below";
  waiting: number;
  iconsOnly: boolean;
  scroller: HTMLElement | null;
}) {
  const Arrow = side === "above" ? PiArrowUpBold : PiArrowDownBold;
  const label = waiting > 0 ? `${waiting} ${waiting === 1 ? "mention" : "mentions"}` : "New activity";
  const color = waiting > 0 ? "var(--gryt-accent-11)" : "var(--gryt-unread)";

  const goToNext = () => {
    if (!scroller) return;
    const rows = rowsOn(scroller, side);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    (rows.find((row) => waiting === 0 || mentionsIn(row) > 0) ?? rows[0])
      ?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      data-gryt={`unread-${side}`}
      aria-label={`${label} ${side}, go to it`}
      onClick={goToNext}
      className={`absolute left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border text-xs shadow-lg transition-colors hover:brightness-110 ${iconsOnly ? "size-8" : "px-3.5 py-1.5"}`}
      style={{
        [side === "above" ? "top" : "bottom"]: 8,
        background: "var(--gryt-neutral-3)",
        borderColor: "var(--gryt-neutral-6)",
        color: "var(--gryt-neutral-12)",
      }}
    >
      {side === "above" && <Arrow aria-hidden="true" size={12} />}
      {iconsOnly
        ? <span aria-hidden="true" className="size-2 rounded-full" style={{ background: color }} />
        : <span style={{ color, fontWeight: 600 }}>{label}</span>}
      {side === "below" && <Arrow aria-hidden="true" size={12} />}
    </button>
  );
}

/** The channel list's scroller, with a pill on each side where a row marked `data-activity` is out of view. */
export function UnreadScroller({ iconsOnly, style, children }: {
  iconsOnly: boolean;
  style: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [above, setAbove] = useState<Waiting>(null);
  const [below, setBelow] = useState<Waiting>(null);

  useEffect(() => {
    const scroller = ref.current;
    if (!scroller) return;
    const update = () => {
      setAbove(measure(scroller, "above"));
      setBelow(measure(scroller, "below"));
    };
    update();
    const mutations = new MutationObserver(update);
    mutations.observe(scroller, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-activity"] });
    const resizes = new ResizeObserver(update);
    resizes.observe(scroller);
    if (scroller.firstElementChild) resizes.observe(scroller.firstElementChild);
    scroller.addEventListener("scroll", update, { passive: true });
    return () => {
      mutations.disconnect();
      resizes.disconnect();
      scroller.removeEventListener("scroll", update);
    };
  }, []);

  // A mask rather than a gradient on top: the sidebar's background changes with the theme.
  const top = above === null ? "#000 0" : `transparent 0, #000 ${FADE_PX}px`;
  const bottom = below === null ? "#000 100%" : `#000 calc(100% - ${FADE_PX}px), transparent 100%`;
  const mask = above === null && below === null ? undefined : `linear-gradient(to bottom, ${top}, ${bottom})`;

  return (
    <div style={{ position: "relative", flex: 1, width: "100%", minHeight: 0, display: "flex" }}>
      <div ref={ref} style={{ ...style, maskImage: mask }}>
        {children}
      </div>
      {above !== null && <Pill side="above" waiting={above} iconsOnly={iconsOnly} scroller={ref.current} />}
      {below !== null && <Pill side="below" waiting={below} iconsOnly={iconsOnly} scroller={ref.current} />}
    </div>
  );
}
