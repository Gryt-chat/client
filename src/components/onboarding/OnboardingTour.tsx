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
/**
 * How long a step is allowed to wait for a target that is on its way.
 *
 * A step that opens a modal has no target for a frame or two, which is
 * indistinguishable from a target that will never arrive. Waiting makes the
 * first case work; the ceiling keeps the second from stranding anybody on a
 * step that cannot render, which is what skipping was there to prevent.
 */
const TARGET_WAIT_MS = 2500;

/**
 * The beats of a step change, and they are deliberately unhurried.
 *
 * "The settings panel just appears, and when you hit next the account tab is
 * just there — no animations, no delay, the human brain cant watch that fast."
 * Every one of these is there to be followed by an eye rather than to be over
 * quickly.
 */
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
 * Press a control the way a person does.
 *
 * Radix opens menus and dialogs off pointerdown, not off a synthetic click, so
 * a bare element.click() moved the drawing without the app noticing. These are
 * real pointer events, which is why the menu now actually opens and the tour
 * can stop pretending.
 */
/**
 * Presses a control for real, **with a click and nothing else**. Base UI opens
 * a menu on pointerdown, so sending the pointer pair and then a click toggles
 * it straight back shut — which read as the tour losing its place from step two
 * onwards.
 *
 * Measured against a real trigger and a real Menu.Item: pointer events alone
 * open the menu and never run an item's onClick; a click alone does both.
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
  /**
   * The step whose words are on the card right now.
   *
   * Kept behind the real step on purpose: the card used to swap its text the
   * instant the step changed, so the next line was readable through a card
   * that was still fading out. The words change while nothing is visible.
   */
  const [shownStep, setShownStep] = useState(step);
  const [pressing, setPressing] = useState(false);
  const [cursorShown, setCursorShown] = useState(false);

  /** When the step's action ran. The wait for its target starts from there. */
  const stepEnteredAt = useRef(0);
  /**
   * Whether the current step has acted yet. The skip-on-missing-target clock
   * used to start when the step became current, while the cursor spends over a
   * second travelling — so steps were given up on before doing anything.
   */
  const stepHasActed = useRef(false);
  /**
   * True while the cursor is walking its route.
   *
   * The resting position below is driven by the target rect, and a step whose
   * target is already on screen resolves it instantly — "Add a server" never
   * goes away, so on the closing step the cursor jumped straight to it and the
   * panel shut behind it with nothing having pressed the X. The route wins
   * until it is finished.
   */
  const walking = useRef(false);
  /** Which step that timestamp belongs to. */
  const timedStepId = useRef<string | null>(null);

  // Started here rather than in the effect below because layout effects run
  // before passive ones: measure() would otherwise read the *previous* step's
  // timestamp, find the wait already expired, and skip a step whose target was
  // still on its way. That skipped two of the five.
  if (step && timedStepId.current !== step.id) {
    timedStepId.current = step.id;
    stepEnteredAt.current = Date.now();
    stepHasActed.current = false;
  }

  /**
   * The choreography, in order, once per step: fade the spotlight and card out,
   * move the cursor, press, let the app respond, settle, then bring the focus
   * back. Done at once it all happens on top of itself and none of it reads.
   */
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    // Claimed before the first await. It used to be set after the fade, and in
    // that 260ms gap the poll resolved the target and dragged both the cursor
    // and the card off to it — visibly, on the step whose target is the
    // always-present Add a server button.
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
          // Skipping quietly is what made the Base UI press bug look like the
          // tour losing its place: the hop vanished, the step timed out waiting
          // for a panel nothing had opened, and it moved on two steps later.
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

      // 4. Lead the eye to the thing before lighting it up.
      //
      //    The cursor used to fade out where it had just pressed, so after
      //    opening Settings it vanished by the avatar and the spotlight lit up
      //    somewhere across the window with nothing connecting the two. It
      //    walks over first, and only then does the focus arrive.
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
    // The route owns the screen until it is done. Measuring mid-walk is what
    // let the card slide to the next target while the cursor was still on its
    // way to press something else.
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

  // No early return on a missing rect any more. It used to unmount the whole
  // tour while a target was on its way — which is exactly when the cursor is
  // travelling to press the button that produces it, so the journey the tour
  // exists to show was the one thing never on screen. The scrim and card wait
  // for a rect; the cursor does not.

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
  // in. Pointing into a modal put the target near the middle of the screen, and
  // the card ran off the edge with its text cut in half, so it flips to the
  // other side when it will not fit.
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
  // `.radix-themes`, a stacking context, so anything within it is sealed under
  // level zero however high its z-index — the tour at 40 lost to a dialog at 1,
  // and no number would have fixed it. It opens modals now.
  return createPortal(
    /* The layer itself stays transparent to the pointer so the control being
       spotlighted is still clickable through it — that is the whole point of a
       cut-out rather than a mask. Only the card takes clicks back. */
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
        /* pointer-events back on, and this is load-bearing rather than tidying.
           A Radix modal sets pointer-events: none on the body so the rest of
           the app goes inert, and this is portaled to body — so from the moment
           a step opened Settings, Skip and Next went inert with everything
           else. The tour became unclickable at step two and stayed that way. */
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
