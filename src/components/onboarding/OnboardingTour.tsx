import { Button } from "@gryt/ui";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";

import { tourSteps } from "./steps";

/** Breathing room between the cut-out and the control it reveals. */
const HALO = 8;
/** Gap between the cut-out and the card. */
const OFFSET = 16;
const CARD_WIDTH = 320;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function readRect(target: string): Rect | null {
  const node = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!node) {
    return null;
  }
  const r = node.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) {
    return null;
  }
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function OnboardingTour({ onFinish }: { onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = tourSteps[index];
  const isLast = index === tourSteps.length - 1;

  // Re-measure on anything that can move the target. A coach mark pointing at
  // where a button used to be is worse than no coach mark.
  //
  // A step whose target is absent or zero-sized is skipped rather than
  // rendered. Returning null instead would end the tour silently at that step,
  // which is what happened the first time: the voice controls are 0x0 until a
  // connection exists, so step 3 killed the whole thing.
  const measure = useCallback(() => {
    if (!step) {
      return;
    }
    const next = readRect(step.target);
    if (next) {
      setRect(next);
      return;
    }
    if (isLast) {
      onFinish();
    } else {
      setIndex((current) => current + 1);
    }
  }, [step, isLast, onFinish]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onFinish();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onFinish]);

  if (!step) {
    return null;
  }

  // No rect yet on the very first paint, or mid-skip. measure() drives the
  // step forward; this only covers the frame in between.
  if (!rect) {
    return null;
  }

  function advance() {
    if (isLast) {
      onFinish();
      return;
    }
    setIndex((current) => current + 1);
  }

  const cut = {
    top: rect.top - HALO,
    left: rect.left - HALO,
    width: rect.width + HALO * 2,
    height: rect.height + HALO * 2
  };

  const card =
    step.side === "right"
      ? {
          top: Math.min(
            Math.max(cut.top + cut.height / 2 - 90, 16),
            window.innerHeight - 220
          ),
          left: cut.left + cut.width + OFFSET
        }
      : {
          top: Math.max(cut.top - 200, 16),
          left: Math.min(
            Math.max(cut.left + cut.width / 2 - CARD_WIDTH / 2, 16),
            window.innerWidth - CARD_WIDTH - 16
          )
        };

  return (
    <div className="fixed inset-0 z-(--gryt-z-tour)">
      {/* One element does the whole scrim. An enormous spread shadow darkens
          everything outside the box, which leaves the control itself lit and
          still clickable — no four-rect construction, no SVG mask. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed rounded-(--gryt-radius-lg) shadow-[0_0_0_9999px_rgb(0_0_0/0.72)] ring-2 ring-gryt-accent transition-[top,left,width,height] duration-(--gryt-dur-spring) ease-spring motion-reduce:transition-none"
        style={cut}
      />

      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={`tour-${step.id}-title`}
        className="fixed w-80 rounded-(--gryt-radius-xl) border border-gryt-border bg-gryt-surface p-4 transition-[top,left] duration-(--gryt-dur-spring) ease-spring motion-reduce:transition-none"
        style={card}
      >
        <p className="m-0 font-mono text-xs tracking-wide text-gryt-accent">
          Step {index + 1} of {tourSteps.length}
        </p>

        <h2
          id={`tour-${step.id}-title`}
          className="mt-2 mb-1 text-base font-semibold text-gryt-text"
        >
          {step.title}
        </h2>

        <p className="m-0 text-sm leading-6 text-gryt-muted">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-3">
          {/* Ghost rather than a bare element: it sits next to a real Button
              and was the only control in the app hand-rolling its own hover and
              focus. Same tone as the secondary in the welcome that hands here. */}
          <Button tone="ghost" size="small" onClick={onFinish}>
            Skip
          </Button>

          <Button size="small" onClick={advance}>
            {isLast ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
