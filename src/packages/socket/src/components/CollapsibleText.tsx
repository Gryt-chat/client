import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Folds a tall message down until somebody asks for the rest.
 *
 * Height rather than character count, because the two disagree in the case
 * that matters. Two hundred newlines is four hundred characters and half a
 * screen; one unbroken paragraph is four thousand characters and six lines. A
 * cap on length is the server's job (it refuses past 4,000) — this is about
 * how much room one message may take before you have to scroll past it.
 *
 * Measured rather than guessed, so the control only appears when there is
 * something behind it. A "show more" on a message that was already fully
 * visible is worse than no control at all.
 */

/** How tall a message may be before it is folded. About twelve lines. */
const COLLAPSED_MAX_PX = 320;

/*
 * Overflow this much and it is worth folding. Without it, a message one line
 * past the cap gets a control that reveals one line, which is a click for
 * nothing and a layout that jumps.
 */
const WORTH_FOLDING_PX = 80;

export function CollapsibleText({ children }: { children: React.ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const el = inner.current;
    if (!el) return;
    setOverflows(el.scrollHeight > COLLAPSED_MAX_PX + WORTH_FOLDING_PX);
  }, []);

  /*
   * A ResizeObserver rather than a measure on mount.
   *
   * The height is not settled when this first renders: custom emoji and code
   * blocks land later, and an edit rewrites the content in place. Measuring
   * once gives a control that is missing on a message that grew, or stranded
   * on one that shrank.
   */
  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") {
      measure();
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  // Nothing to fold: render the content and no wrapper state at all, so the
  // overwhelming majority of messages pay nothing for this.
  if (!overflows && !expanded) {
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
        // The message is not hidden from assistive technology when folded —
        // it is all in the DOM and only clipped — so this says what it does
        // rather than claiming to load anything.
        aria-expanded={expanded}
      >
        {expanded ? "Show less" : "Show full message"}
      </button>
    </div>
  );
}
