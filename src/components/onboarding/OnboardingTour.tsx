import { Button } from "@gryt/ui";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";

import type { TourControls } from "./steps";
import { tourSteps } from "./steps";
import { TourCursor } from "./TourCursor";

/** Breathing room between the cut-out and the control it reveals. */
const HALO = 8;
/** Gap between the cut-out and the card. */
const OFFSET = 16;
const CARD_WIDTH = 320;
/** A step that opens a modal has no target for a frame or two, which looks the
    same as one that never arrives. */
const TARGET_WAIT_MS = 2500;

/** Deliberately unhurried: these are meant to be followed by an eye. */

/** Focus off the old thing before anything moves. */
const FADE_MS = 260;
/** Long enough to be followed across the window. */
const TRAVEL_MS = 900;
/** The press, and a moment to register it landed. */
const PRESS_MS = 320;
/** After the app acts, before the focus returns, so they do not overlap. */
const SETTLE_MS = 650;
/** Between hops, for the menu or panel the last press opened to arrive. */
const HOP_MS = 420;
const TARGET_POLL_MS = 60;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * A click and nothing else: Base UI opens a menu on pointerdown, so the pointer
 * pair plus a click toggles it shut again. Measured against a real Menu.Item.
 */
function pressControl(target: string): void {
  const node = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!node) return;
  node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

/** Wait for a target to exist, up to a ceiling. Null if it never turns up. */
async function waitForRect(target: string, timeoutMs: number): Promise<Rect | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = readRect(target);
    if (found) return found;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }
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

  const reduceMotion = useReducedMotion();
  // Starts in the middle, where an eye already is, rather than sliding in from
  // a corner nobody was looking at.
  const [cursor, setCursor] = useState(() => ({
    x: typeof window === "undefined" ? 0 : window.innerWidth / 2,
    y: typeof window === "undefined" ? 0 : window.innerHeight / 2
  }));
  const [focusShown, setFocusShown] = useState(false);
  /** Kept behind the real step: swapping the text on the change made the next
      line readable through a card that was still fading out. */
  const [shownStep, setShownStep] = useState(step);
  const [pressing, setPressing] = useState(false);
  const [cursorShown, setCursorShown] = useState(false);

  /** When the step's action ran. The wait for its target starts from there. */
  const stepEnteredAt = useRef(0);
  /** The skip clock used to start when the step became current, while the cursor
      spends over a second travelling. */
  const stepHasActed = useRef(false);
  /** The resting position is driven by the target rect, which for an always-there
      target resolves instantly. The route wins until it is finished. */
  const walking = useRef(false);
  /** Which step that timestamp belongs to. */
  const timedStepId = useRef<string | null>(null);

  // Here rather than the effect below, because layout effects run first and
  // measure() would read the previous step's timestamp as already expired.
  if (step && timedStepId.current !== step.id) {
    timedStepId.current = step.id;
    stepEnteredAt.current = Date.now();
    stepHasActed.current = false;
  }

  /** Fade out, move, press, let the app respond, settle, bring focus back. Done
      at once it all happens on top of itself and none of it reads. */
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    // Before the first await: set after the fade, the poll resolved the target in
    // that gap and dragged the cursor and card off to it.
    walking.current = true;

    const sleep = (ms: number) =>
      new Promise((resolve) => window.setTimeout(resolve, ms));
    const pause = (ms: number) => (reduceMotion ? 0 : ms);

    void (async () => {
      // 1. Focus off the old thing before anything moves, and the cursor back
      //    on so there is something to follow.
      setFocusShown(false);
      await sleep(pause(FADE_MS));
      if (cancelled) return;
      setRect(null);
      setShownStep(step);
      setCursorShown(true);

      // 2. Walk the route, pressing for real at each stop. Two hops is usual:
      //    the avatar opens its menu, then Settings inside it opens the panel.
      for (const anchor of step.via ?? []) {
        const at = readRect(anchor);
        if (!at) {
          // Skipping quietly made the press bug look like the tour losing its
          // place, two steps later and with nothing said.
          console.warn(`[tour] no control for "${anchor}" — skipping this hop`);
          continue;
        }
        setCursor({ x: at.left + at.width / 2, y: at.top + at.height / 2 });
        await sleep(pause(TRAVEL_MS));
        if (cancelled) return;
        setPressing(true);
        await sleep(pause(PRESS_MS));
        if (cancelled) return;
        setPressing(false);
        pressControl(anchor);
        // Whatever that opened needs a moment before the next hop can be found.
        await sleep(pause(HOP_MS));
        if (cancelled) return;
      }

      walking.current = false;

      // 3. Anything the route could not do on its own.
      step.enter?.(controlsRef.current);
      stepEnteredAt.current = Date.now();
      stepHasActed.current = true;

      // Lead the eye before lighting it up: the cursor used to fade out where it
      // pressed while the spotlight lit somewhere across the window.
      await sleep(pause(SETTLE_MS));
      if (cancelled) return;

      const destination = await waitForRect(step.target, TARGET_WAIT_MS);
      if (cancelled) return;
      if (destination) {
        setCursor({
          x: destination.left + destination.width / 2,
          y: destination.top + destination.height / 2
        });
        await sleep(pause(TRAVEL_MS));
        if (cancelled) return;
      }

      // 5. Focus in, and the cursor withdraws so it is not covering the very
      //    text the card is pointing at.
      setFocusShown(true);
      await sleep(pause(200));
      if (cancelled) return;
      setCursorShown(false);
    })();

    return () => {
      cancelled = true;
      walking.current = false;
    };
  }, [step, reduceMotion]);

  // The cursor comes to rest on whatever the card is describing, so it ends up
  // pointing at the thing rather than at the button that revealed it.
  useEffect(() => {
    if (!rect || walking.current) return;
    setCursor({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }, [rect]);

  // A mark pointing where a button used to be is worse than none. An absent or
  // zero-sized target is waited for and then skipped.
  const measure = useCallback(() => {
    if (!step) {
      return;
    }
    // The route owns the screen until it is done: measuring mid-walk slid the card
    // to the next target while the cursor was still travelling.
    if (walking.current) {
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
    if (!stepHasActed.current) {
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

  // A target inside a modal moves without producing layout the observers see, so
  // this polls for as long as the tour runs. measure() only sets on a move.
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

  // No early return on a missing rect: it used to unmount the tour while a target
  // was on its way, which is exactly when the cursor is travelling to it.

  function advance() {
    if (isLast) {
      onFinish();
      return;
    }
    setIndex((current) => current + 1);
  }

  const cut = rect && {
    top: rect.top - HALO,
    left: rect.left - HALO,
    width: rect.width + HALO * 2,
    height: rect.height + HALO * 2
  };

  // Sitting to the right of the target only works while there is a right to sit
  // in, so the card flips to the other side when it will not fit.
  const rightOfTarget = cut ? cut.left + cut.width + OFFSET : 0;
  const fitsOnTheRight = rightOfTarget + CARD_WIDTH + 16 <= window.innerWidth;

  const card = !cut
    ? null
    : step.side === "right"
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

  // **Portaled to body, and it has to be.** The app renders inside
  // `.radix-themes`, a stacking context, so no z-index would beat a dialog.
  return createPortal(
    /* The layer stays transparent to the pointer so the spotlighted control is
       still clickable through it. Only the card takes clicks back. */
    <div data-gryt="tour" className="pointer-events-none fixed inset-0 z-(--gryt-z-tour)">
      {/* One element does the whole scrim. An enormous spread shadow darkens
          everything outside the box, which leaves the control itself lit and
          still clickable — no four-rect construction, no SVG mask. */}
      {cut && card && (
        <>
      <div
        aria-hidden="true"
        className="pointer-events-none fixed rounded-(--gryt-radius-lg) shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] ring-2 ring-gryt-accent transition-[top,left,width,height,opacity] duration-(--gryt-dur-spring) ease-spring motion-reduce:transition-none"
        style={{ ...cut, opacity: focusShown ? 1 : 0 }}
      />

      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby={`tour-${shownStep.id}-title`}
        /* pointer-events back on, and load-bearing: a Radix modal sets
           pointer-events: none on the body, and this is portaled to body. */
        className="fixed w-80 rounded-(--gryt-radius-xl) border border-gryt-border bg-gryt-surface p-4 transition-[top,left,opacity] duration-(--gryt-dur-spring) ease-spring motion-reduce:transition-none"
        style={{
          ...card,
          opacity: focusShown ? 1 : 0,
          // Faded out means gone, not merely invisible. A card you cannot see
          // must not be catching the clicks meant for what is under it.
          pointerEvents: focusShown ? "auto" : "none"
        }}
      >
        <p className="m-0 font-mono text-xs tracking-wide text-gryt-accent">
          Step {index + 1} of {tourSteps.length}
        </p>

        <h2
          id={`tour-${shownStep.id}-title`}
          className="mt-2 mb-1 text-base font-semibold text-gryt-text"
        >
          {shownStep.title}
        </h2>

        <p className="m-0 text-sm leading-6 text-gryt-muted">{shownStep.body}</p>

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
        </>
      )}

      <TourCursor x={cursor.x} y={cursor.y} pressing={pressing} visible={cursorShown} />
    </div>,
    document.body
  );
}
