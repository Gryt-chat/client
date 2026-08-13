/* Hallmark · component: overlay affordance · genre: modern-minimal
 * theme: @gryt/ui (design.md) · states: travelling · pressing · resting · reduced-motion
 * pre-emit critique: P5 H5 E5 S5 R5 V4
 */
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * A drawn cursor for the tour to move around with.
 *
 * The tour opens modals on the user's behalf, and doing that invisibly is what
 * made it hard to follow: Settings arrived out of nowhere and nothing said
 * which button it came from. So the tour presses the button first, and this is
 * the thing that does the pressing.
 *
 * It is a drawing, never a real pointer. `pointer-events: none` is the whole
 * contract — the tour card only just got its clicks back (GRYT-200) and a
 * cursor that intercepted them would be a poor joke.
 */

/** Unhurried, and damped hard enough never to overshoot onto a neighbour. */
const TRAVEL = { type: "spring", stiffness: 130, damping: 22, mass: 1 } as const;
/** How far the inner dot leans out of centre while it is moving. */
const LEAD = 6;
/** Long enough to cover the travel; the lean springs back to nothing after. */
const LEAD_MS = 520;

export function TourCursor({
  x,
  y,
  pressing,
  visible
}: {
  x: number;
  y: number;
  pressing: boolean;
  visible: boolean;
}) {
  const reduceMotion = useReducedMotion();

  // The inner dot leans the way it is going, so the thing reads as steering
  // itself rather than being dragged. Direction comes from the step it just
  // took; it relaxes back to centre once it has arrived.
  const previous = useRef({ x, y });
  const [lean, setLean] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const dx = x - previous.current.x;
    const dy = y - previous.current.y;
    previous.current = { x, y };

    const distance = Math.hypot(dx, dy);
    // A short hop leaves the lean where it was, which is how the inner dot ended
    // up parked off-centre for good. Anything too small to lean into resets it.
    if (reduceMotion || distance < 24) {
      setLean({ x: 0, y: 0 });
      return;
    }

    setLean({ x: (dx / distance) * LEAD, y: (dy / distance) * LEAD });
    const id = window.setTimeout(() => setLean({ x: 0, y: 0 }), LEAD_MS);
    return () => window.clearTimeout(id);
  }, [x, y, reduceMotion]);

  return (
    <motion.div
      aria-hidden="true"
      data-gryt="tour-cursor"
      className="pointer-events-none fixed top-0 left-0"
      style={{ width: 0, height: 0 }}
      initial={false}
      animate={{ x, y, opacity: visible ? 1 : 0 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { ...TRAVEL, opacity: { duration: 0.2 } }
      }
    >
      {/* Both circles bounce together on the press: down hard, then back up
          past rest. Low damping on the return is what makes it read as a
          bounce rather than a fade, and it is the shape the library's own
          buttons spring with. */}
      <motion.div
        animate={{ scale: pressing && !reduceMotion ? 0.72 : 1 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { type: "spring", stiffness: 520, damping: 12, mass: 0.6 }
        }
      >
        {/* Outer: soft, wide, behind. The halo, not the pointer.

            Deliberately not the accent. The spotlight ring is accent, the
            buttons it presses are accent, and a purple dot on purple was
            invisible. A pointer should read against whatever it is over, which
            is why real ones are pale with a dark edge rather than a brand
            colour. */}
        <div className="absolute rounded-full"
          style={{
            left: -19,
            top: -19,
            width: 38,
            height: 38,
            background: "color-mix(in oklab, var(--gryt-tour-cursor) 38%, transparent)",
            boxShadow: "0 0 0 1px rgb(0 0 0 / 0.25)"
          }}
        />

        {/* Inner: solid, small, and leading. */}
        <motion.div
          className="absolute rounded-full"
          style={{
            left: -7,
            top: -7,
            width: 14,
            height: 14,
            background: "var(--gryt-tour-cursor)",
            // A pale rim rather than a dark one: red on a dark app needs
            // lifting off the background, not outlining against it.
            border: "1px solid rgb(255 255 255 / 0.75)",
            boxShadow: "0 2px 10px rgb(0 0 0 / 0.5)"
          }}
          animate={{ x: lean.x, y: lean.y }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 260, damping: 18 }
          }
        />
      </motion.div>
    </motion.div>
  );
}
