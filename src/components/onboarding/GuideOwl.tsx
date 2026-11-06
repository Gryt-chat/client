import { useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

// Sivert's guide owl (Default/Point/Hiding.svg, 1269x1269), moving the way it does in the gryt.chat video.
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
const PIVOT = { x: 1010, y: 905 };
const ARM_ANGLE = 46;
const EYES = { left: { x: 492, y: 744 }, right: { x: 778, y: 745 } };
const arc = (c: { x: number; y: number }) => `M${c.x - 52} ${c.y + 18}Q${c.x} ${c.y - 46} ${c.x + 52} ${c.y + 18}`;

/** 130px on the video's 1920px stage, scaled to how big that reads in the app. */
const SIZE = 96;
const K = SIZE / 130;
const GAP = 14;
const EDGE = 8;
const CONTROLS_HEIGHT = 40;

export type Mood = "open" | "happy" | "wink";

interface OwlPose {
  lookX: number;
  lookY: number;
  /** 0 sits, 1 the raised pointing stance, -1 ducked behind the ring. */
  rise: number;
  arm: number;
  /** Degrees from straight ahead, clockwise. */
  aim: number;
  /** -1..1: the body sliding forward inside the ring while it travels. */
  shift: number;
  paws: number;
  blink: number;
  mood: Mood;
}

function Owl({ pose, mirrored }: { pose: OwlPose; mirrored: boolean }) {
  const id = useId();
  const dy = pose.rise >= 0 ? -61 * pose.rise : -323 * pose.rise;
  const fx = 44 * pose.lookX, fy = 44 * pose.lookY;
  const ex = 88 * pose.lookX, ey = 88 * pose.lookY;
  const turn = pose.aim - ARM_ANGLE;
  return (
    <svg width={SIZE} height={SIZE} viewBox="0 0 1269 1269" overflow="visible" style={{ transform: mirrored ? "scaleX(-1)" : undefined }}>
      <defs>
        <clipPath id={`${id}c`}><circle cx="634.5" cy="634.5" r="604" /></clipPath>
        <filter id={`${id}p`} x="-10%" y="-10%" width="120%" height="120%">
          <feOffset dy="-4" in="SourceAlpha" result="o" />
          <feGaussianBlur in="o" stdDeviation="1.5" result="b" />
          <feComposite in="b" in2="SourceAlpha" operator="out" result="s" />
          <feColorMatrix in="s" values="0 0 0 0 0.18 0 0 0 0 0.176 0 0 0 0 0.37 0 0 0 0.4 0" />
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Inside the ring only: at full size its edge showed around the outside of the ring. */}
      <circle cx="634.5" cy="634.5" r="604" fill="#2E2D5F" />
      <g clipPath={`url(#${id}c)`}>
        <g transform={`translate(${70 * pose.shift} ${dy})`}>
          <path d={BODY} fill="#A495E3" />
          <path d={SIDE_R} fill="#7C6EC3" />
          <path d={SIDE_L} fill="#7C6EC3" />
          <path d={FACE} fill="#B5A8E6" transform={`translate(${fx} ${fy})`} />
          <g transform={`translate(${ex} ${ey})`} fill="#2E2D5F">
            {(["left", "right"] as const).map((side) => {
              const c = EYES[side];
              const shut = pose.mood === "happy" || (pose.mood === "wink" && side === "right");
              if (shut) return <path key={side} d={arc(c)} fill="none" stroke="#2E2D5F" strokeWidth="26" strokeLinecap="round" />;
              const sy = 1 - 0.9 * pose.blink;
              return <path key={side} d={side === "left" ? EYE_L : EYE_R} transform={`translate(0 ${c.y * (1 - sy)}) scale(1 ${sy})`} />;
            })}
            <path d={BEAK} />
          </g>
        </g>
      </g>
      <path d={RING} strokeWidth="64" stroke="#16162F" fill="none" />
      {pose.paws > 0.01 && (
        <g filter={`url(#${id}p)`} fill="#7C6EC3" opacity={pose.paws} transform={`translate(0 ${(1 - pose.paws) * 90})`}>
          <path d={PAW_L} />
          <path d={PAW_R} opacity={1 - Math.min(1, pose.arm * 2)} />
          {pose.arm > 0.01 && (
            <path
              d={ARM}
              // Pulls in toward the shoulder: scaled about the pivot, not the drawing's corner.
              transform={`translate(0 ${dy}) rotate(${turn} ${PIVOT.x} ${PIVOT.y}) translate(${PIVOT.x} ${PIVOT.y}) scale(${0.4 + 0.6 * pose.arm}) translate(${-PIVOT.x} ${-PIVOT.y})`}
              style={{ transformBox: "view-box" }}
              opacity={Math.min(1, pose.arm * 2)}
            />
          )}
        </g>
      )}
    </svg>
  );
}

const ease = {
  inOut: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 4),
  in: (t: number) => t * t * t,
  spring: (t: number) => (t >= 1 ? 1 : 1 - Math.exp(-6.5 * t) * Math.cos(8.5 * t)),
};

interface Tween { from: number; to: number; start: number; dur: number; e: (t: number) => number }

function makeTweens(initial: Record<string, number>) {
  const values = new Map(Object.entries(initial));
  const tweens = new Map<string, Tween>();
  const get = (key: string) => {
    const tw = tweens.get(key);
    if (!tw) return values.get(key) ?? 0;
    const p = Math.min(1, Math.max(0, (performance.now() - tw.start) / tw.dur));
    if (p >= 1) {
      values.set(key, tw.to);
      tweens.delete(key);
    }
    return tw.from + (tw.to - tw.from) * tw.e(p);
  };
  const to = (key: string, v: number, dur: number, e: (t: number) => number, still: boolean) => {
    if (still) {
      tweens.delete(key);
      values.set(key, v);
      return;
    }
    tweens.set(key, { from: get(key), to: v, start: performance.now(), dur, e });
  };
  return { get, to };
}

/** Shut for 140ms every 4.3s, and every third time a double blink. */
function blinkAt(t: number) {
  const k = t % 4300;
  const one = (from: number) => (k > from && k < from + 140 ? Math.sin(((k - from) / 140) * Math.PI) : 0);
  return Math.max(one(4000), Math.floor(t / 4300) % 3 === 0 ? one(3780) : 0);
}

/** How far away something has to be before the eyes turn all the way to it. */
const REACH = 360;

/** Eyes that turn further the further away it is: centred on the owl, all the way at REACH. */
function gaze(dx: number, dy: number) {
  const d = Math.hypot(dx, dy) || 1;
  const m = Math.min(1, d / REACH);
  return { x: (dx / d) * m, y: (dy / d) * m };
}

/** Per second: how quickly the eyes catch up. Low enough that they ease over instead of snapping. */
const EYE_EASE = 2.2;

/** Somewhere random to look, with its eyes well off centre. */
function spot() {
  const angle = Math.random() * Math.PI * 2;
  const reach = 0.5 + Math.random() * 0.5;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach };
}

/** Either it watches your cursor, or for 5-6s it looks around at things of its own, a few seconds each. */
function nextWander(now: number, idle: boolean) {
  const until = now + 5000 + Math.random() * 1500;
  return {
    looks: [spot(), spot(), spot()],
    from: now,
    until,
    next: until + (idle ? 3000 + Math.random() * 2000 : 7000 + Math.random() * 5000),
  };
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

/** Left of the target and level with it, as in the video. Right of it only when the left would cover it. */
function homeFor(target: Rect | null) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!target) return { x: vw / 2, y: vh / 2, mirrored: false };
  const y = Math.min(vh - SIZE / 2 - EDGE, Math.max(SIZE / 2 + EDGE, target.top + target.height / 2));
  const left = Math.max(110 * K, Math.min(vw / 2, target.left - 140 * K));
  if (left + SIZE / 2 + GAP <= target.left) return { x: left, y, mirrored: false };
  return { x: Math.min(vw - SIZE / 2 - EDGE, target.left + target.width + GAP + SIZE / 2), y, mirrored: true };
}

export interface Line {
  id: string;
  title: string;
  body?: string;
}

/**
 * The owl pops up, drifts beside `target` and says `line` in a bubble that stays until the line
 * changes. `controls` sit under it, or above it near the bottom of the window.
 */
export function GuideOwl({
  target,
  line,
  mood,
  waving,
  point,
  controls,
}: {
  target: Rect | null;
  line: Line | null;
  mood: Mood;
  waving: boolean;
  point: boolean;
  controls: ReactNode;
}) {
  const still = useReducedMotion() ?? false;
  const hiding = usePasswordFocused();
  const [, setFrame] = useState(0);
  const [tw] = useState(() => makeTweens({ scale: 0, rise: -1, paws: 0, arm: 0, pop: 0, o: 0 }));
  const state = useRef({
    pos: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    vel: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    lean: 0,
    last: performance.now(),
    cursor: null as { x: number; y: number } | null,
    movedAt: 0,
    /** 0 while it travels, 1 once it has stopped: the arm only comes out at 1. */
    settled: 1,
    wander: { looks: [spot()], from: 0, until: 0, next: performance.now() + 6000 },
  });
  // With no target, between steps, it stays where it was rather than heading for the middle.
  const homeRef = useRef(homeFor(null));
  if (target) homeRef.current = homeFor(target);
  const home = homeRef.current;
  const targetRef = useRef(target);
  targetRef.current = target;
  const [said, setSaid] = useState<Line | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      state.current.cursor = { x: e.clientX, y: e.clientY };
      state.current.movedAt = performance.now();
    };
    window.addEventListener("pointermove", move);
    let frame = requestAnimationFrame(function tick(now) {
      const s = state.current;
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      const h = homeRef.current;
      if (still) {
        s.pos = { x: h.x, y: h.y };
        s.vel = { x: 0, y: 0 };
      } else if (dt > 0) {
        // A critically damped spring that leans into its own acceleration, like a segway.
        const k = 5, c = 2 * Math.sqrt(k);
        const ax = k * (h.x - s.pos.x) - c * s.vel.x;
        const ay = k * (h.y - s.pos.y) - c * s.vel.y;
        s.vel.x += ax * dt;
        s.vel.y += ay * dt;
        s.pos.x += s.vel.x * dt;
        s.pos.y += s.vel.y * dt;
        s.lean += (Math.max(-14, Math.min(14, ax * 0.006)) - s.lean) * Math.min(1, dt * 10);
      }
      const t = targetRef.current;
      let want = { x: 0, y: 0 };
      if (!still && s.cursor) want = gaze(s.cursor.x - s.pos.x, s.cursor.y - s.pos.y);
      else if (t) want = gaze(t.left + t.width / 2 - s.pos.x, t.top + t.height / 2 - s.pos.y);
      const w = s.wander;
      if (now > w.next) s.wander = nextWander(now, now - s.movedAt > 2000);
      if (!still && now < w.until) want = w.looks[Math.min(2, Math.floor((now - w.from) / 2200))];
      const speed = Math.hypot(s.vel.x, s.vel.y);
      const m = Math.min(1, speed / 300);
      const go = { x: s.vel.x / (speed || 1), y: s.vel.y / (speed || 1) };
      s.settled = still ? 1 : s.settled + ((speed < 25 ? 1 : 0) - s.settled) * (1 - Math.exp(-8 * dt));
      const follow = 1 - Math.exp(-EYE_EASE * dt);
      s.look.x += (want.x * (1 - m) + go.x * m - s.look.x) * follow;
      s.look.y += (want.y * (1 - m) + go.y * m - s.look.y) * follow;
      setFrame((n) => n + 1);
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
    };
  }, [still]);

  // Entrance, as in the video: the ring pops, the owl peeks over the rim, then comes up with its paws.
  useEffect(() => {
    let cancelled = false;
    const wait = (ms: number) => new Promise((r) => window.setTimeout(r, still ? 0 : ms));
    tw.to("o", 1, 300, ease.out, false);
    tw.to("scale", 1, 700, ease.spring, still);
    void (async () => {
      await wait(250);
      if (cancelled) return;
      tw.to("rise", -0.55, 600, ease.out, still);
      await wait(600);
      if (cancelled) return;
      tw.to("rise", 0, 420, ease.spring, still);
      tw.to("paws", 1, 420, ease.out, still);
    })();
    return () => {
      cancelled = true;
    };
  }, [tw, still]);

  // Points while it talks unless it's waving, then tucks the arm back in. The bubble stays.
  useEffect(() => {
    const tuck = () => {
      tw.to("arm", 0, 380, ease.inOut, still);
      tw.to("rise", 0, 420, ease.inOut, still);
    };
    if (!line) {
      tw.to("pop", 0, 280, ease.in, still);
      if (!waving) tuck();
      return;
    }
    let cancelled = false;
    const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    setSaid(line);
    tw.to("pop", 0, 1, ease.out, true);
    tw.to("pop", 1, 800, ease.spring, still);
    if (!point && !waving) {
      tuck();
      return;
    }
    tw.to("rise", 1, 450, ease.out, still);
    tw.to("arm", 1, 520, ease.spring, still);
    void (async () => {
      await wait(700 + (line.title.length + (line.body?.length ?? 0)) * 38);
      if (cancelled || waving) return;
      tuck();
    })();
    return () => {
      cancelled = true;
    };
    // waving and point are read once per line on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line?.id, tw, still]);

  useEffect(() => {
    if (waving) return;
    tw.to("arm", 0, 380, ease.inOut, still);
    tw.to("rise", 0, 420, ease.inOut, still);
  }, [waving, tw, still]);

  const s = state.current;
  const { x, y } = s.pos;
  const now = performance.now();
  const sign = home.mirrored ? -1 : 1;
  let aim = 0;
  if (waving) aim = -15 + 20 * Math.sin(now / 160);
  else if (target) {
    const ax = Math.abs(target.left + target.width / 2 - x) || 1;
    // Never steeply up: a raised straight arm reads as a salute.
    aim = Math.max(-20, Math.min(70, (Math.atan2(target.top + target.height / 2 - y, ax) * 180) / Math.PI));
  }
  const rise = hiding ? -1 : tw.get("rise");
  const pop = hiding ? 0 : tw.get("pop");
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  // Laid out from where it's going, not where it is mid-flight, so nothing flips sides on the way.
  const controlsBelow = home.y + SIZE / 2 + GAP + CONTROLS_HEIGHT < vh;
  const row = controls ? CONTROLS_HEIGHT + 8 : 0;
  const bubbleHeight = bubbleRef.current?.offsetHeight ?? 120;
  const bubbleAbove = home.y - SIZE / 2 - GAP - bubbleHeight - (controlsBelow ? 0 : row) >= EDGE;
  const bubblePlace = bubbleAbove
    ? { bottom: SIZE / 2 + GAP + (controlsBelow ? 0 : row) }
    : { top: SIZE / 2 + GAP + (controlsBelow ? row : 0) };
  const left = Math.min(Math.max(home.x - SIZE / 2, EDGE), vw - 280 - EDGE) - home.x;

  return (
    <div data-gryt="guide-owl" className="pointer-events-none fixed" style={{ left: x, top: y, opacity: tw.get("o") }}>
      <div
        aria-hidden="true"
        className="absolute"
        style={{
          left: -SIZE / 2,
          top: -SIZE / 2,
          width: SIZE,
          height: SIZE,
          transform: `rotate(${s.lean}deg) scale(${tw.get("scale")})`,
          transformOrigin: "50% 50%",
        }}
      >
        <Owl
          mirrored={home.mirrored}
          pose={{
            lookX: sign * s.look.x,
            lookY: s.look.y,
            rise,
            arm: hiding ? 0 : tw.get("arm") * s.settled,
            aim,
            shift: sign * Math.max(-1, Math.min(1, s.vel.x / 500)),
            paws: tw.get("paws"),
            blink: still ? 0 : blinkAt(now),
            mood,
          }}
        />
      </div>
      {said && pop > 0.01 && (
        <div
          key={said.id}
          ref={bubbleRef}
          role="status"
          className="absolute"
          style={{
            left,
            ...bubblePlace,
            width: "max-content",
            maxWidth: 280,
            transformOrigin: bubbleAbove ? "0% 100%" : "0% 0%",
            transform: `scale(${0.6 + 0.4 * pop})`,
            opacity: Math.min(1, pop * 1.2),
            padding: "9px 13px",
            borderRadius: 16,
            background: "var(--gryt-neutral-12)",
            color: "var(--gryt-neutral-1)",
            fontSize: 17,
            fontWeight: 700,
            lineHeight: 1.3,
            letterSpacing: "-0.01em",
            boxShadow: "0 18px 50px rgba(0,0,0,.4)",
          }}
        >
          {said.title}
          {said.body && <p className="mt-1 mb-0 text-sm leading-5 font-normal opacity-80">{said.body}</p>}
        </div>
      )}
      {controls && !hiding && (
        <div
          className="pointer-events-auto absolute"
          style={{ left, ...(controlsBelow ? { top: SIZE / 2 + GAP } : { bottom: SIZE / 2 + GAP }) }}
        >
          {controls}
        </div>
      )}
    </div>
  );
}
