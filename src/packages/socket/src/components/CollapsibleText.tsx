import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Folds a tall message down until somebody asks for the rest. Height rather than
 * character count: two hundred newlines is half a screen and 400 characters.
 */

/** How much of a folded message stays visible. */
const COLLAPSED_MAX_LINES = 20;

/*
 * And how much has to be behind the fold for the fold to pay for itself. Equal
 * to the cap, so a message is only folded once folding hides as much as it shows.
 */
const WORTH_FOLDING_LINES = 20;

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
  const [fold, setFold] = useState<{ maxPx: number; hiddenLines: number } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const el = inner.current;
    if (!el) return;

    /*
     * The message itself, not the wrapper: the chat font-size slider is set on
     * `.markdown-message`, and the wrapper would report the surrounding size.
     */
    const text = el.querySelector(".markdown-message") ?? el;
    const styles = getComputedStyle(text);

    // `lineHeight` comes back as "normal" when nothing set it, hence the ratio.
    const parsed = Number.parseFloat(styles.lineHeight);
    const lineHeight = Number.isFinite(parsed)
      ? parsed
      : Number.parseFloat(styles.fontSize) * ASSUMED_LINE_RATIO;

    const maxPx = Math.round(lineHeight * COLLAPSED_MAX_LINES);
    const hiddenPx = el.scrollHeight - maxPx;

    if (hiddenPx < lineHeight * WORTH_FOLDING_LINES) {
      setFold(null);
      return;
    }

    // Floored at 1 rather than claiming 0.
    setFold({ maxPx, hiddenLines: Math.max(1, Math.floor(hiddenPx / lineHeight)) });
  }, []);

  const folds = fold !== null;

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
        style={expanded ? undefined : { maxHeight: fold.maxPx, overflow: "hidden" }}
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
            Show <span className="message-fold-count">{fold.hiddenLines}</span> more{" "}
            {fold.hiddenLines === 1 ? "line" : "lines"}
          </>
        )}
        <Chevron up={expanded} />
      </button>
    </div>
  );
}
