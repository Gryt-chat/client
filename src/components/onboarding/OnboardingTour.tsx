import { Button } from "@gryt/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";

import type { TourControls } from "./steps";
import { tourSteps } from "./steps";

/** Breathing room between the cut-out and the control it reveals. */
const HALO = 8;
/** Gap between the cut-out and the card. */
const OFFSET = 16;
const CARD_WIDTH = 320;
/**
 * How long a step is allowed to wait for a target that is on its way.
 *
 * A step that opens a modal has no target for a frame or two, which is
 * indistinguishable from a target that will never arrive. Waiting makes the
 * first case work; the ceiling keeps the second from stranding anybody on a
 * step that cannot render, which is what skipping was there to prevent.
 */
const TARGET_WAIT_MS = 1500;
const TARGET_POLL_MS = 60;

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

  const { openSettings, setShowSettings } = useSettings();
  const { setShowAddServer } = useServerManagement();

  // Held in a ref so changing step does not rebuild `measure` through them.
  const controlsRef = useRef<TourControls>({
    openSettings: () => undefined,
    closeSettings: () => undefined,
    setShowAddServer: () => undefined,
  });
  controlsRef.current = {
    openSettings,
    closeSettings: () => setShowSettings(false),
    setShowAddServer,
  };

  /** When the current step became current, for the wait below. */
  const stepEnteredAt = useRef(0);
  /** Which step that timestamp belongs to. */
  const timedStepId = useRef<string | null>(null);

  // Started here rather than in the effect below because layout effects run
  // before passive ones: measure() would otherwise read the *previous* step's
  // timestamp, find the wait already expired, and skip a step whose target was
  // still on its way. That skipped two of the five.
  if (step && timedStepId.current !== step.id) {
    timedStepId.current = step.id;
    stepEnteredAt.current = Date.now();
  }

  // Opening happens once per step, not on every re-measure.
  useEffect(() => {
    if (!step) return;
    setRect(null);
    // Read through the ref so the controls, which are rebuilt every render,
    // cannot re-trigger this and open the modal a second time.
    step.enter?.(controlsRef.current);
  }, [step]);

  // Re-measure on anything that can move the target. A coach mark pointing at
  // where a button used to be is worse than no coach mark.
  //
  // A target that is absent or zero-sized is waited for, then skipped. Skipping
  // immediately is what the first version did, and it is still the right end
  // state — the voice controls are 0x0 until a connection exists, and a step
  // that can never render must not kill the tour. But a step that just opened a
  // modal looks exactly like that for a frame or two, so it gets TARGET_WAIT_MS
  // before being given up on.
  const measure = useCallback(() => {
    if (!step) {
      return;
    }
    const next = readRect(step.target);
    if (next) {
      // Only when it actually moved, or the poll below would re-render forever.
      setRect((current) =>
        current &&
        current.top === next.top &&
        current.left === next.left &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next
      );
      return;
    }
    if (Date.now() - stepEnteredAt.current < TARGET_WAIT_MS) {
      return;
    }
    if (isLast) {
      onFinish();
    } else {
      setIndex((current) => current + 1);
    }
  }, [step, isLast, onFinish]);

  useLayoutEffect(measure, [measure]);

  // The observers below only fire on layout the app happens to do, and a target
  // inside a modal moves without producing any: switching the settings
  // destination re-flows the panel while the body stays exactly the same size,
  // so nothing fires and the spotlight stays where the last target was. It sat
  // on "Addons" while pointing at the sign-in button.
  //
  // So this runs for as long as the tour does, not just while waiting for a
  // target to appear. A getBoundingClientRect every 60ms costs nothing next to
  // being wrong, and measure() only sets state when the rect has moved.
  useEffect(() => {
    const id = window.setInterval(measure, TARGET_POLL_MS);
    return () => window.clearInterval(id);
  }, [measure]);

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

  // Sitting to the right of the target only works while there is a right to sit
  // in. Pointing into a modal put the target near the middle of the screen, and
  // the card ran off the edge with its text cut in half, so it flips to the
  // other side when it will not fit.
  const rightOfTarget = cut.left + cut.width + OFFSET;
  const fitsOnTheRight = rightOfTarget + CARD_WIDTH + 16 <= window.innerWidth;

  const card =
    step.side === "right"
      ? {
          top: Math.min(
            Math.max(cut.top + cut.height / 2 - 90, 16),
            window.innerHeight - 220
          ),
          left: fitsOnTheRight
            ? rightOfTarget
            : Math.max(cut.left - CARD_WIDTH - OFFSET, 16)
        }
      : {
          top: Math.max(cut.top - 200, 16),
          left: Math.min(
            Math.max(cut.left + cut.width / 2 - CARD_WIDTH / 2, 16),
            window.innerWidth - CARD_WIDTH - 16
          )
        };

  // Portaled to body, and it has to be.
  //
  // The app renders inside `.radix-themes`, which is position: relative with
  // z-index: 0 — a stacking context. Anything inside it is sealed under level
  // zero of the root, however high its own z-index goes, while Radix Themes
  // portals its dialogs straight to body as siblings. So the tour at z-index 40
  // lost to a dialog at z-index 1, and no number would have fixed it.
  //
  // That never showed while the tour only pointed at things already on screen.
  // It opens modals now, so it has to live in the same stacking context they do.
  return createPortal(
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
    </div>,
    document.body
  );
}
