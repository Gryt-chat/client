import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Folds a tall message down until somebody asks for the rest.
 *
 * Height rather than character count, because the two disagree in the case that
 * matters: two hundred newlines is four hundred characters and half a screen,
 * one unbroken paragraph is four thousand characters and six lines.
 *
 * Nothing is loaded when it opens — the whole message arrived with the message,
 * and the server's 4,000 cap is what bounds what it sends.
 */

/** How tall a message may be before it is folded. About twelve lines. */
const COLLAPSED_MAX_PX = 320;

/*
 * Overflow this much and it is worth folding. Without it, a message one line
 * past the cap gets a control that reveals one line, which is a click for
 * nothing and a layout that jumps.
 */
const WORTH_FOLDING_PX = 80;

/** Falls back to this when the computed line-height is `normal`. */
const ASSUMED_LINE_RATIO = 1.5;

/*
 * Two paths rather than one path rotated.
 *
 * A CSS `transform` on this chevron computed to the identity matrix in the
 * running client — measured with an inline style, on both an `<svg>` and a
 * `<span>` wrapper, with no competing rule and reduced-motion off, while the
 * same declaration on a plain div beside it rotated fine. Two path strings
 * cannot fail, and there is nothing to animate away.
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
     * How many lines are behind the fold, so the control can say. `lineHeight`
     * comes back as "normal" when nothing set it, which is not a number — hence
     * the ratio. Rounded down and floored at 1: claiming "0 more lines" on a
     * control that demonstrably has more is worse than being one out.
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
   * Measure directly, then observe for later changes. Both, not just the
   * observer: ResizeObserver is specified to deliver an initial callback for an
   * element with a box, and relying on that alone left a message that never
   * folded when it did not arrive — a fresh observer on a 618x1440 element
   * stayed silent for the better part of a second. The observer still earns its
   * place for content that lands late: custom emoji, code blocks, an edit
   * rewriting the text in place.
   *
   * `folds` is in the deps because the element is remounted when the wrapper
   * appears — the observer would otherwise be left watching a detached node.
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
        // The message is not hidden from assistive technology when folded — it
        // is all in the DOM and only clipped — so this reports a disclosure
        // rather than claiming to fetch anything.
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
