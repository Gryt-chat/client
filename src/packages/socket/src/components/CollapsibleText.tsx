import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Folds a tall message down until somebody asks for the rest. Height rather than
 * character count: two hundred newlines is half a screen and 400 characters.
 */

/** How tall a message may be before it is folded. About twelve lines. */
const COLLAPSED_MAX_PX = 320;

/*
 * Overflow this much and it is worth folding. Without it, a message one line past
 * the cap gets a control that reveals one line and a layout that jumps.
 */
const WORTH_FOLDING_PX = 80;

/** Falls back to this when the computed line-height is `normal`. */
const ASSUMED_LINE_RATIO = 1.5;

/*
 * Two paths rather than one path rotated: a CSS `transform` on this chevron
 * computed to the identity matrix in the running client, measured several ways.
 */
function Chevron({ up }: { up: boolean }) {
  return (
    <svg
      className="message-fold-chevron"
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={up ? "M3.5 10L8 5.5L12.5 10" : "M3.5 6L8 10.5L12.5 6"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CollapsibleText({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [hiddenLines, setHiddenLines] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const el = inner.current;
    if (!el) return;

    const full = el.scrollHeight;
    if (full <= COLLAPSED_MAX_PX + WORTH_FOLDING_PX) {
      setHiddenLines(0);
      return;
    }

    /*
     * How many lines are behind the fold. `lineHeight` comes back as "normal"
     * when nothing set it, hence the ratio; floored at 1 rather than claiming 0.
     */
    const styles = getComputedStyle(el);
    const parsed = Number.parseFloat(styles.lineHeight);
    const lineHeight = Number.isFinite(parsed)
      ? parsed
      : Number.parseFloat(styles.fontSize) * ASSUMED_LINE_RATIO;

    setHiddenLines(Math.max(1, Math.floor((full - COLLAPSED_MAX_PX) / lineHeight)));
  }, []);

  const folds = hiddenLines > 0;

  /*
   * Measure directly, then observe. ResizeObserver's initial callback did not
   * arrive for a 618x1440 element, so a message never folded.
   */
  useEffect(() => {
    const el = inner.current;
    if (!el) return;

    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, folds]);

  // Nothing to fold: render the content and no wrapper state at all, so the
  // overwhelming majority of messages pay nothing for this.
  if (!folds) {
    return (
      <div ref={inner} className="message-fold-inner">
        {children}
      </div>
    );
  }

  return (
    <div className="message-fold">
      <div
        ref={inner}
        className="message-fold-inner"
        style={expanded ? undefined : { maxHeight: COLLAPSED_MAX_PX, overflow: "hidden" }}
      >
        {children}
      </div>

      {/* Only when folded. An expanded message needs no hint that there is
          more, because there is not. */}
      {!expanded && <div className="message-fold-fade" aria-hidden="true" />}

      <button
        type="button"
        className="message-fold-toggle"
        onClick={() => setExpanded((open) => !open)}
        // The message is not hidden from assistive technology when folded — it is
        // in the DOM and only clipped — so this reports a disclosure.
        aria-expanded={expanded}
      >
        {expanded ? (
          "Show less"
        ) : (
          <>
            Show <span className="message-fold-count">{hiddenLines}</span> more{" "}
            {hiddenLines === 1 ? "line" : "lines"}
          </>
        )}
        <Chevron up={expanded} />
      </button>
    </div>
  );
}
