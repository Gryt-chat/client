/* Hallmark · component: overlay · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states: verifying · slow · exiting · reduced-motion
 *   — a splash has no interactive controls, so the 8-state checklist does not
 *     apply; these are the four it actually has.
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { Logo } from "@/common";

import { isElectron } from "../lib/electron";
import { TITLEBAR_HEIGHT } from "./titlebar";

/**
 * How long before the wait is acknowledged out loud.
 *
 * useAccount gives Keycloak 12 seconds and then forces signed-out, so the worst
 * case here was twelve seconds of a spinner and no explanation, followed by
 * being dropped into the app as a guest. Five is long enough that a normal
 * start never sees it.
 */
const SLOW_AFTER_MS = 5_000;

/**
 * How long after being dismissed this gives up on the fade and just goes
 * (GRYT-911).
 *
 * The overlay used to be removed by `AnimatePresence`, once the exit animation
 * finished. That is fine while the animation runs, and it does not run in a
 * background tab: browsers pause `requestAnimationFrame` there, so the fade
 * stops wherever it got to and the element it was fading is never unmounted.
 *
 * The result was an app that had decided somebody was signed out, rendered
 * itself behind, and stayed behind a half-transparent sheet — measured at 48
 * seconds, and it would have stayed forever. Starting Gryt and looking at
 * something else while it loads is the whole of what it takes.
 *
 * `setTimeout` is throttled in a hidden tab rather than paused, which is why
 * the backstop is one and the animation is not.
 */
const FADE_GIVE_UP_SLACK_MS = 400;

export function AuthLoadingOverlay({
  open,
  fadeDurationMs = 450,
}: {
  open: boolean;
  fadeDurationMs?: number;
}) {
  // Left uncovered on purpose, so the window stays draggable and closable while
  // this is up. It is the one piece of chrome that must never be behind a
  // loading screen.
  const titlebarHeight = isElectron() ? TITLEBAR_HEIGHT : 0;

  const reduceMotion = useReducedMotion();
  const [slow, setSlow] = useState(false);

  /*
   * Whether the fade has been given long enough. Nothing to do with how the
   * fade is going — this deliberately does not ask, because the case it exists
   * for is the one where the fade is not going at all.
   */
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (!open) {
      setSlow(false);
      return;
    }
    const id = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (open) {
      setFaded(false);
      return;
    }
    const id = window.setTimeout(
      () => setFaded(true),
      (reduceMotion ? 150 : fadeDurationMs) + FADE_GIVE_UP_SLACK_MS,
    );
    return () => window.clearTimeout(id);
  }, [open, fadeDurationMs, reduceMotion]);

  /* Gone, animation or no animation. A splash that outlives the thing it was
     waiting for is worse than one that disappears without a fade. */
  if (!open && faded) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="auth-loading-overlay"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: reduceMotion ? 0.15 : fadeDurationMs / 1000,
            ease: "easeInOut"
          }}
          style={{
            position: "fixed",
            top: titlebarHeight,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: "var(--gryt-z-splash)",
            background: "var(--gryt-bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            /* Dropped the moment this is dismissed, before the fade has
               finished and whether or not it ever does. Somebody who can see
               the app behind a half-faded sheet should be able to use it, and
               a sheet that is on its way out has no business swallowing a
               click. */
            pointerEvents: open ? "all" : "none",
            userSelect: "none"
          }}
          role="status"
          aria-label="Checking whether you are signed in"
          aria-live="polite"
          /* Not busy once it is leaving, and hidden from a screen reader
             entirely — a sheet mid-exit is decoration, and announcing it again
             on the way out is announcing something that is no longer true. */
          aria-busy={open}
          aria-hidden={!open}
        >
          <div className="flex flex-col items-center gap-6">
            <Logo />

            {/* A travelling hairline rather than a spinner.

                A rotating ring is the most generic loading mark there is, and
                design.md builds this system out of flat surfaces separated by
                hairlines — so the rule the app already uses everywhere does the
                waiting instead. Only transform moves; the rail itself is static. */}
            <div
              style={{
                position: "relative",
                width: 168,
                height: 2,
                overflow: "hidden",
                borderRadius: 999,
                background: "var(--gryt-border)"
              }}
            >
              {reduceMotion ? (
                // Nothing travels. A still rail at rest reads as "working"
                // without motion, and the copy below carries the meaning.
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "var(--gryt-accent)",
                    opacity: 0.45
                  }}
                />
              ) : (
                <motion.div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    width: "40%",
                    borderRadius: 999,
                    background: "var(--gryt-accent)"
                  }}
                  animate={{ x: ["-100%", "250%"] }}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    ease: "easeInOut"
                  }}
                />
              )}
            </div>

            {/* Crossfaded rather than swapped, so the line does not jump the
                moment the wait becomes worth mentioning. */}
            <div style={{ minHeight: 40, maxWidth: "22rem" }}>
              <AnimatePresence mode="wait">
                {slow ? (
                  <motion.div
                    key="slow"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <p className="text-sm text-gryt-muted text-center" style={{ margin: 0, lineHeight: 1.5 }}>
                      This is taking longer than it should. Gryt will carry on
                      without an account in a moment.
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="normal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <p className="text-sm text-gryt-muted text-center" style={{ margin: 0 }}>
                      Checking whether you&rsquo;re signed in
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <span className="text-xs text-gryt-muted" style={{
              position: "absolute",
              bottom: 12,
              left: 16,
              fontFamily: "var(--code-font-family)",
              opacity: 0.5
            }}>
            v{__APP_VERSION__}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
