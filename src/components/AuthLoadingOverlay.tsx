/* Hallmark · component: overlay · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states: verifying · slow · exiting · reduced-motion · critique: P5 H5 E5 S5 R5 V4 */
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { Logo } from "@/common";

import { isElectron } from "../lib/electron";
import { TITLEBAR_HEIGHT } from "./titlebar";

/**
 * How long before the wait is acknowledged out loud. useAccount gives Keycloak 12
 * seconds; five is long enough that a normal start never sees this.
 */
const SLOW_AFTER_MS = 5_000;

/**
 * How long after being dismissed this gives up on the fade and just goes. A
 * background tab pauses rAF, so `AnimatePresence` never unmounted it (GRYT-911).
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
  // this is up.
  const titlebarHeight = isElectron() ? TITLEBAR_HEIGHT : 0;

  const reduceMotion = useReducedMotion();
  const [slow, setSlow] = useState(false);

  /*
   * Whether the fade has been given long enough. Deliberately does not ask how
   * the fade is going: the case it exists for is the fade not going at all.
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
            /* Dropped the moment this is dismissed, whether or not the fade ever
               finishes. A sheet on its way out must not swallow a click. */
            pointerEvents: open ? "all" : "none",
            userSelect: "none"
          }}
          role="status"
          aria-label="Checking whether you are signed in"
          aria-live="polite"
          /* Not busy once it is leaving, and hidden from a screen reader — a
             sheet mid-exit is decoration. */
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
