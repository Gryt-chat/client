import { Button } from "@gryt/ui";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";

import { GuideOwl, type Rect } from "./GuideOwl";
import type { TourControls } from "./steps";
import { tourSteps } from "./steps";

/** Breathing room between the cut-out and the control it reveals. */
const HALO = 8;
/** A step that opens a modal has no target for a frame or two, which looks the same as one that never arrives. */
const TARGET_WAIT_MS = 2500;

const FADE_MS = 260;
const HELLO = { id: "hello", text: "Hi! Let me show you around." };
/** The entrance, then the wave while it says hi, in the middle of the window. */
const HELLO_MS = 3600;
/** The owl's spring takes about this long to settle beside the next control. */
const FLY_MS = 1300;
/** Between hops, for the menu or panel the last press opened to arrive. */
const HOP_MS = 420;
const SETTLE_MS = 650;
const TARGET_POLL_MS = 60;

/** A click and nothing else: Base UI opens a menu on pointerdown, so a pointer pair plus a click shuts it again. */
function pressControl(target: string): void {
  const node = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!node) return;
  node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

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

  // In a ref so changing step doesn't rebuild `measure` through them.
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
  /** The control the owl is flying to press while the step walks its route. */
  const [hop, setHop] = useState<Rect | null>(null);
  const [waving, setWaving] = useState(true);
  const greeted = useRef(false);
  const [focusShown, setFocusShown] = useState(false);
  /** Lags the real step so the old line doesn't swap while its bubble fades out. */
  const [shownStep, setShownStep] = useState(step);

  const stepEnteredAt = useRef(0);
  /** The skip clock starts once the step has acted, not while the owl is still flying. */
  const stepHasActed = useRef(false);
  /** The route owns the screen until it's done, or measuring mid-walk jumps ahead to the target. */
  const walking = useRef(false);
  const timedStepId = useRef<string | null>(null);

  // Here rather than in an effect: layout effects run first and would read the last step's timestamp.
  if (step && timedStepId.current !== step.id) {
    timedStepId.current = step.id;
    stepEnteredAt.current = Date.now();
    stepHasActed.current = false;
  }

  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    walking.current = true;

    const sleep = (ms: number) =>
      new Promise((resolve) => window.setTimeout(resolve, ms));
    const pause = (ms: number) => (reduceMotion ? 0 : ms);

    void (async () => {
      if (!greeted.current) {
        await sleep(pause(HELLO_MS));
        if (cancelled) return;
        greeted.current = true;
      }
      setWaving(false);
      setFocusShown(false);
      await sleep(pause(FADE_MS));
      if (cancelled) return;
      setRect(null);
      setShownStep(step);

      // The owl sits by each control on the route while it's pressed for real.
      for (const anchor of step.via ?? []) {
        const at = readRect(anchor);
        if (!at) {
          console.warn(`[tour] no control for "${anchor}" — skipping this hop`);
          continue;
        }
        setHop(at);
        await sleep(pause(FLY_MS));
        if (cancelled) return;
        pressControl(anchor);
        await sleep(pause(HOP_MS));
        if (cancelled) return;
      }

      walking.current = false;
      step.enter?.(controlsRef.current);
      stepEnteredAt.current = Date.now();
      stepHasActed.current = true;

      await sleep(pause(SETTLE_MS));
      if (cancelled) return;
      const destination = await waitForRect(step.target, TARGET_WAIT_MS);
      if (cancelled) return;
      if (destination) {
        setHop(destination);
        await sleep(pause(FLY_MS));
        if (cancelled) return;
      }
      setHop(null);
      setFocusShown(true);
    })();

    return () => {
      cancelled = true;
      walking.current = false;
    };
  }, [step, reduceMotion]);

  // An absent or zero-sized target is waited for and then skipped.
  const scrolledTo = useRef<string | null>(null);
  const measure = useCallback(() => {
    if (!step || walking.current) {
      return;
    }
    const next = readRect(step.target);
    if (next && scrolledTo.current !== step.target) {
      // Once per step: inside a scrolled pane the target can sit below the fold.
      scrolledTo.current = step.target;
      document.querySelector(`[data-tour="${step.target}"]`)?.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "nearest",
      });
    }
    if (next) {
      // Only when it actually moved, or the poll below re-renders forever.
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
  }, [step, isLast, onFinish, reduceMotion]);

  useLayoutEffect(measure, [measure]);

  // A target inside a modal moves without layout the observers see, so this polls while the tour runs.
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

  function advance() {
    if (isLast) {
      onFinish();
      return;
    }
    setIndex((current) => current + 1);
  }

  const lit = focusShown ? rect : null;
  const stepLine = lit && { id: shownStep.id, text: shownStep.line };
  const cut = lit && {
    top: lit.top - HALO,
    left: lit.left - HALO,
    width: lit.width + HALO * 2,
    height: lit.height + HALO * 2
  };

  // Portaled to body: the app renders inside `.radix-themes`, a stacking context no z-index here would beat.
  return createPortal(
    // Transparent to the pointer so the lit control stays clickable; only the owl's controls take clicks back.
    <div data-gryt="tour" className="pointer-events-none fixed inset-0 z-(--gryt-z-tour)">
      {cut && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-(--gryt-radius-lg) shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] ring-2 ring-gryt-accent transition-[top,left,width,height] duration-(--gryt-dur-spring) ease-spring motion-reduce:transition-none"
          style={cut}
        />
      )}

      <GuideOwl
        target={hop ?? lit}
        mood={waving ? "happy" : shownStep.mood ?? "open"}
        waving={waving && !reduceMotion}
        line={waving ? HELLO : stepLine}
        controls={
          lit && (
            <div
              role="dialog"
              aria-modal="false"
              aria-label={shownStep.line}
              className="flex items-center gap-2 rounded-full bg-gryt-surface py-1 pr-1 pl-3 shadow-[0_10px_30px_rgb(0_0_0/0.35)]"
            >
              <span className="font-mono text-xs text-gryt-muted">
                {tourSteps.indexOf(shownStep) + 1}/{tourSteps.length}
              </span>
              <Button tone="ghost" size="small" onClick={onFinish}>
                Skip
              </Button>
              <Button size="small" onClick={advance}>
                {isLast ? "Done" : "Next"}
              </Button>
            </div>
          )
        }
      />
    </div>,
    document.body
  );
}
