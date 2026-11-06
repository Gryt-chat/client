import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useState } from "react";

// Sivert's guide owl (Default/Point/Hiding.svg, 1269x1269), drawn in parts so it can rise, point, look and blink.
const BODY = "M239.884 926.727C243.177 913.113 242.794 851.152 242.071 836.363C230.602 602.556 406.03 433.2 637.883 440.21C750.663 443.622 841.202 464.015 924.829 548.432C1033.22 657.844 1030.99 781.939 1029.39 923.973C1102.85 1095.97 1117.85 1252.44 1051.04 1433.1C1032.39 1483.53 989.484 1553.75 947.424 1588.24C912.887 1608.89 877.59 1629.9 836.658 1634.74C832.219 1646.93 830.654 1655.2 821.017 1663.62C793.478 1665.11 794.79 1661.41 772.95 1681.58C758.767 1683.54 758.022 1683.81 743.87 1673.16C742.161 1671.87 740.462 1670.55 738.781 1669.22C709.405 1671.33 706.188 1677.57 689.593 1650.62L584.224 1650.57C553.04 1696.05 558.299 1651.27 514.512 1680.99C497.577 1682.23 476.439 1669.75 459.62 1664.75C444.063 1660.12 441.786 1652.15 435.301 1637.28C382.307 1626.86 364.426 1604.86 325.482 1588.89C278.119 1554.18 236.54 1481 216.794 1427.04C153.339 1253.63 166.099 1092.41 239.884 926.727Z";
const SIDE_R = "M1029.39 923.973C1102.85 1095.97 1117.85 1252.44 1051.04 1433.1C1032.39 1483.53 989.485 1553.75 947.425 1588.24C859.821 1463.12 860.363 1205.86 936.599 1078.79C968.216 1026.09 1002.73 980.645 1029.39 923.973Z";
const SIDE_L = "M239.884 926.729C270.912 985.743 311.074 1036.21 341.458 1091.53C409.026 1214.55 404.418 1380.04 362.221 1510.7C353.875 1535.49 343.002 1568.3 325.482 1588.9C278.119 1554.18 236.54 1481.01 216.794 1427.04C153.339 1253.63 166.099 1092.41 239.884 926.729Z";
const FACE = "M767.297 602C851.152 602 919.665 649.641 924.194 732.172H924.434C924.434 733.836 924.418 735.498 924.389 737.16C924.418 738.397 924.434 739.638 924.434 740.882C924.434 749.32 923.765 757.603 922.478 765.68C919.385 792.102 912.642 818.026 902.397 842.702C887.848 877.744 866.523 909.584 839.641 936.404C812.758 963.224 780.844 984.499 745.72 999.014C710.597 1013.53 672.951 1021 634.934 1021C596.916 1021 559.27 1013.53 524.147 999.014C489.023 984.499 457.109 963.224 430.226 936.404C403.344 909.584 382.019 877.744 367.471 842.702C357.226 818.026 350.482 792.103 347.388 765.681C346.102 757.604 345.434 749.321 345.434 740.882C345.434 739.638 345.448 738.397 345.477 737.16C345.449 735.498 345.434 733.836 345.434 732.172H345.673C350.203 649.641 418.716 602 502.571 602C558.155 602 631.63 633.119 634.934 633.119C638.237 633.119 711.713 602 767.297 602Z";
const EYE_R = "M760.051 694.204C788.025 684.093 818.879 698.712 828.776 726.765C838.673 754.817 823.824 785.563 795.698 795.251C767.873 804.834 737.528 790.175 727.736 762.42C717.944 734.664 732.374 704.207 760.051 694.204Z";
const EYE_L = "M473.864 694.19C501.693 684.202 532.345 698.687 542.299 726.53C552.25 754.373 537.727 785.01 509.876 794.93C482.072 804.831 451.504 790.338 441.571 762.546C431.634 734.751 446.085 704.16 473.864 694.19Z";
const BEAK = "M634.792 822.192C631.245 822.171 638.811 822.212 634.792 822.192C695.037 822.544 659.003 889.612 638.519 925.83C636.937 928.626 632.85 928.515 631.379 925.658C612.549 889.101 574.755 822.191 634.792 822.192Z";
const RING = "M1237 634.5C1237 967.252 967.252 1237 634.5 1237C301.748 1237 32 967.252 32 634.5C32 301.748 301.748 32 634.5 32C967.252 32 1237 301.748 1237 634.5Z";
const PAW_L = "M224.1 1151.99C139.348 1116.1 166.663 955.814 225.979 945.417C285.295 935.02 319.127 971.358 347.688 1006.92C376.248 1042.48 394.538 1068.39 378.619 1101.54C362.701 1134.68 308.852 1187.87 224.1 1151.99Z";
const PAW_R = "M1038.77 1145.99C1123.52 1110.1 1096.21 949.814 1036.89 939.417C977.576 929.02 943.744 965.358 915.183 1000.92C886.623 1036.48 868.333 1062.39 884.252 1095.54C900.17 1128.68 954.019 1181.87 1038.77 1145.99Z";
const ARM = "M1026.84 864.43C1026.84 864.43 911.832 967.518 993.822 1061.01C1075.81 1154.5 1192.83 1185.88 1228.31 1195C1263.79 1204.13 1334.34 1218.55 1357.84 1212.51C1381.35 1206.46 1380.8 1183.51 1337.31 1119.01C1293.81 1054.51 1278.29 1037.2 1219.31 986.009C1160.33 934.819 1081.19 876.113 1026.84 864.43Z";
/** Top of the shoulder in Point.svg. The drawn arm reaches out 46° below horizontal. */
const PIVOT = "1010px 905px";
const ARM_ANGLE = 46;
const EYES = { left: { x: 492, y: 744 }, right: { x: 778, y: 745 } };
const arc = (c: { x: number; y: number }) => `M${c.x - 52} ${c.y + 18}Q${c.x} ${c.y - 46} ${c.x + 52} ${c.y + 18}`;

const SIZE = 64;
const GAP = 14;
const EDGE = 8;
const BUBBLE_WIDTH = 256;
const BUBBLE_HEIGHT = 136;

export type Mood = "open" | "happy";

interface OwlPose {
  /** 1 is the raised pointing stance, -1 ducked behind the ring. */
  rise: number;
  pointing: boolean;
  /** Degrees from straight ahead, clockwise. */
  aim: number;
  /** -1..1 each, in the owl's own frame: +x is the way the arm points. */
  look: { x: number; y: number };
  blink: boolean;
  mood: Mood;
}

function Owl({ pose, mirrored, still }: { pose: OwlPose; mirrored: boolean; still: boolean }) {
  const clip = useId();
  const dy = pose.rise >= 0 ? -61 * pose.rise : -323 * pose.rise;
  const look = pose.rise < 0 ? { x: 0, y: 0 } : pose.look;
  const ease = (ms: number) => (still ? "none" : `transform ${ms}ms var(--ease-spring, ease), opacity ${ms}ms ease`);
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 1269 1269" overflow="visible" style={{ transform: mirrored ? "scaleX(-1)" : undefined }}>
      <defs>
        <clipPath id={clip}><circle cx="634.5" cy="634.5" r="620" /></clipPath>
      </defs>
      <circle cx="634.5" cy="634.5" r="603" fill="#2E2D5F" />
      <g clipPath={`url(#${clip})`}>
        <g style={{ transform: `translateY(${dy}px)`, transition: ease(450) }}>
          <path d={BODY} fill="#A495E3" />
          <path d={SIDE_R} fill="#7C6EC3" />
          <path d={SIDE_L} fill="#7C6EC3" />
          <path d={FACE} fill="#B5A8E6" style={{ transform: `translate(${20 * look.x}px, ${20 * look.y}px)`, transition: ease(500) }} />
          <g fill="#2E2D5F" style={{ transform: `translate(${40 * look.x}px, ${40 * look.y}px)`, transition: ease(500) }}>
            {(["left", "right"] as const).map((side) =>
              pose.mood === "happy" ? (
                <path key={side} d={arc(EYES[side])} fill="none" stroke="#2E2D5F" strokeWidth="26" strokeLinecap="round" />
              ) : (
                <path
                  key={side}
                  d={side === "left" ? EYE_L : EYE_R}
                  style={{ transform: `scaleY(${pose.blink ? 0.1 : 1})`, transformBox: "fill-box", transformOrigin: "center", transition: still ? "none" : "transform 70ms ease" }}
                />
              ),
            )}
            <path d={BEAK} />
          </g>
        </g>
      </g>
      <path d={RING} strokeWidth="64" stroke="#16162F" fill="none" />
      <g fill="#7C6EC3" style={{ opacity: pose.rise < -0.5 ? 0 : 1, transition: ease(200) }}>
        <path d={PAW_L} />
        <path d={PAW_R} style={{ opacity: pose.pointing ? 0 : 1, transition: ease(200) }} />
        <path
          d={ARM}
          style={{
            transformBox: "view-box",
            transformOrigin: PIVOT,
            transform: `translateY(${dy}px) rotate(${pose.pointing ? pose.aim - ARM_ANGLE : 40}deg) scale(${pose.pointing ? 1 : 0.4})`,
            opacity: pose.pointing ? 1 : 0,
            transition: ease(520),
          }}
        />
      </g>
    </svg>
  );
}

/** Shut for a moment every few seconds, at a slightly uneven pace so it doesn't tick. */
function useBlink(off: boolean) {
  const [shut, setShut] = useState(false);
  useEffect(() => {
    if (off) return;
    let timer = 0;
    const next = () => {
      timer = window.setTimeout(() => {
        setShut(true);
        timer = window.setTimeout(() => {
          setShut(false);
          next();
        }, 140);
      }, 3200 + Math.random() * 2400);
    };
    next();
    return () => window.clearTimeout(timer);
  }, [off]);
  return shut;
}

function usePasswordFocused() {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const check = () => setFocused(document.activeElement instanceof HTMLInputElement && document.activeElement.type === "password");
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    // A focused field that gets removed, with its dialog, fires no focusout.
    const id = window.setInterval(check, 500);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
      window.clearInterval(id);
    };
  }, []);
  return focused;
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Slow enough to follow with your eye across the window. */
export const FLY_MS = 1100;
/** How long it looks at what it's pointing at before its eyes go back to your cursor. */
const WATCH_AFTER_MS = 2500;
const WAVE_MS = 280;

function usePointer(on: boolean) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setAt({ x: e.clientX, y: e.clientY }));
    };
    window.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [on]);
  return on ? at : null;
}

/**
 * Starts in the middle of the window, waves if `waving`, then flies beside `target`, level
 * with it on the side with more room, and points. The bubble sits above or below, never on it.
 */
export function GuideOwl({ target, mood, waving, bubble }: { target: Rect | null; mood: Mood; waving: boolean; bubble: ReactNode }) {
  const still = useReducedMotion() ?? false;
  const blink = useBlink(still);
  const hiding = usePasswordFocused();
  const [spot, setSpot] = useState(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2, mirrored: false }));
  const [watching, setWatching] = useState(false);
  const pointer = usePointer(watching && !still);
  const [wave, setWave] = useState(0);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let aim = 0;
  let look = { x: 0.6, y: 0.2 };
  if (target) {
    const cx = target.left + target.width / 2;
    const cy = target.top + target.height / 2;
    const mirrored = cx < vw / 2;
    const x = mirrored ? target.left + target.width + GAP + SIZE / 2 : target.left - GAP - SIZE / 2;
    const next = {
      x: Math.min(Math.max(x, SIZE / 2 + EDGE), vw - SIZE / 2 - EDGE),
      y: Math.min(Math.max(cy, SIZE / 2 + EDGE), vh - SIZE / 2 - EDGE),
      mirrored,
    };
    if (next.x !== spot.x || next.y !== spot.y || next.mirrored !== spot.mirrored) setSpot(next);
    const dx = Math.abs(cx - spot.x) || 1;
    aim = Math.max(-60, Math.min(70, (Math.atan2(cy - spot.y, dx) * 180) / Math.PI));
    look = { x: 0.8, y: Math.max(-0.6, Math.min(0.6, (cy - spot.y) / Math.hypot(dx, cy - spot.y))) };
  }
  if (pointer) {
    const dx = pointer.x - spot.x;
    const dy = pointer.y - spot.y;
    const d = Math.hypot(dx, dy) || 1;
    look = { x: ((spot.mirrored ? -dx : dx) / d) * 0.8, y: Math.max(-0.6, Math.min(0.6, dy / d)) };
  }

  useEffect(() => {
    setWatching(false);
    if (waving) return;
    const id = window.setTimeout(() => setWatching(true), WATCH_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [spot.x, spot.y, waving]);

  useEffect(() => {
    if (!waving || still) return;
    const id = window.setInterval(() => setWave((n) => n + 1), WAVE_MS);
    return () => window.clearInterval(id);
  }, [waving, still]);

  const above = spot.y - SIZE / 2 - GAP - BUBBLE_HEIGHT > EDGE;
  let bubbleFrom = spot.mirrored ? spot.x - SIZE / 2 : spot.x + SIZE / 2 - BUBBLE_WIDTH;
  if (waving) bubbleFrom = spot.x - BUBBLE_WIDTH / 2;
  const bubbleLeft = Math.min(
    Math.max(bubbleFrom, EDGE),
    vw - BUBBLE_WIDTH - EDGE,
  );
  const fly = still ? "none" : `left ${FLY_MS}ms cubic-bezier(.45,0,.25,1), top ${FLY_MS}ms cubic-bezier(.45,0,.25,1)`;

  return (
    <>
      <motion.div
        aria-hidden="true"
        data-gryt="guide-owl"
        className="pointer-events-none fixed"
        initial={still ? false : { opacity: 0, scale: 0.3 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        style={{ left: spot.x - SIZE / 2, top: spot.y - SIZE / 2, width: SIZE, height: SIZE, transition: fly }}
      >
        <Owl
          mirrored={spot.mirrored}
          still={still}
          pose={{
            rise: hiding ? -1 : 1,
            pointing: (waving || target !== null) && !hiding,
            aim: waving ? -65 + 20 * (wave % 2 ? -1 : 1) : aim,
            look: waving ? { x: 0, y: 0 } : look,
            blink,
            mood,
          }}
        />
      </motion.div>
      {bubble && !hiding && (
        <div
          className="fixed"
          style={{
            left: bubbleLeft,
            width: BUBBLE_WIDTH,
            transition: fly,
            ...(above ? { bottom: vh - (spot.y - SIZE / 2 - GAP) } : { top: spot.y + SIZE / 2 + GAP }),
          }}
        >
          {bubble}
        </div>
      )}
    </>
  );
}
