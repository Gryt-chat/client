import { useRef } from "react";

import { Owl } from "./owl";
import { sfx } from "./sfx";
import { ease, flat, get, H, hold, set, to, useFrame, W } from "./stage";
import { worn } from "./wardrobe";

export type Expression =
  | "eyes-happy" | "eyes-big" | "eyes-starry" | "eyes-star" | "eyes-wink-right" | "eyes-wink-left"
  | "eyes-sleeping" | "eyes-evil" | "eyes-annoyed" | "eyes-eyelashes-surprised";
type Mood = "open" | "happy" | "wink" | "focus" | "scared" | "squint";
type Anchor = string | (() => Element | null | undefined);

let line = { text: "", n: 0 };
let mood: Mood = "open";
let talkingUntil = 0;
export const isTalking = () => performance.now() < talkingUntil;
/** Where Sivert placed the owl for the current beat, and where its bubble sits relative to the owl's top-left. */
let spot = { x: W / 2, y: H / 2 };
let bubble = { dx: 0, dy: -70 };
let pointTarget: Element | null = null;
let waving = false;
let snapN = 0;
let gaze: Element | null = null;
let stiff = 5;
let lastNew: { el: Element; at: number } | null = null;
/** Gryt's eyes go to whatever just appeared on screen, so the viewer follows them there. */
export function watchActivity() {
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) {
      if (!(n instanceof HTMLElement) || n.closest("#overhead") || n.offsetHeight < 16) continue;
      lastNew = { el: n, at: performance.now() };
    }
  }).observe(document.body, { childList: true, subtree: true });
}
/** Eyes shut, arms in, a slow glow: how Gryt does the things that are not a click. */
export function meditate(on: boolean) {
  mood = on ? "focus" : "open";
  if (on) { pointTarget = null; to("owl.arm", 0, 300, ease.inOut); }
  to("owl.rise", on ? 0.35 : 0, 500, ease.inOut);
  to("owl.aura", on ? 1 : 0, on ? 500 : 400, ease.inOut);
}
/** Looks at an element without pointing at it. */
export function lookAt(el: Element | null) { gaze = el; }
/** How hard the float pulls to its spot: 5 is the usual glide, much higher is a jolt. */
export function setStiffness(k: number) { stiff = k; }

/** Shut for 140ms every 4.3s, with every third one a double blink. */
export function blinkAt(t: number) {
  const k = t % 4300;
  const one = (from: number) => (k > from && k < from + 140 ? Math.sin(((k - from) / 140) * Math.PI) : 0);
  return Math.max(one(4000), Math.floor(t / 4300) % 3 === 0 ? one(3780) : 0);
}

/** Moves the owl to a spot from the storyboard; `b` is the bubble's offset from the owl's top-left. */
export function place(x: number, y: number, b?: { dx: number; dy: number }) {
  spot = { x, y };
  if (b) bubble = b;
}

/** Puts the owl right on top of `el`, with no travel. */
export function placeOn(el: Element) {
  const p = stagePoint(el);
  spot = p;
  snapN++;
}

/** The owl says something: a new bubble pops, the film waits long enough to read it, then the bubble goes. */
// Lines queue, so Gryt can keep acting under one without the next cutting it short.
let speaking = Promise.resolve();
export function say(text: string, expression?: Expression, at?: Anchor, m: Mood = "open") {
  return (speaking = speaking.then(() => speak(text, expression, at, m)));
}
async function speak(text: string, _expression?: Expression, _at?: Anchor, m: Mood = "open") {
  line = { text, n: line.n + 1 };
  mood = m;
  set("guide.pop", 0);
  to("guide.pop", 1, 520, ease.spring);
  to("guide.o", 1, 300, ease.out);
  sfx("bubble");
  // Read-aloud pace: about 200 words a minute, plus a second to notice the bubble.
  const words = text.trim().split(/\s+/).length;
  talkingUntil = performance.now() + words * 260;
  await hold(Math.max(1800, 1000 + words * 300));
  to("guide.pop", 0, 280, ease.in);
}

/** Raises up and points its arm at `el` until relax(): what the cursor is about to click, or what to look at. */
let pointSide: "left" | "right" = "right";
export function pointAt(el: Element | null) {
  // The wing is chosen once, from where the target sits against where Gryt is headed, and kept for the whole point.
  if (el && el !== pointTarget) pointSide = stagePoint(el).x < spot.x - 40 ? "left" : "right";
  pointTarget = el;
  to("owl.rise", 1, 450, ease.out);
  to("owl.arm", 1, 520, ease.spring);
}
export function relax(el?: Element) {
  if (el && pointTarget !== el) return;
  pointTarget = null;
  to("owl.arm", 0, 380, ease.inOut);
  to("owl.rise", 0, 420, ease.inOut);
}

/** Smiles and waves, toward the right, for `ms`. */
export async function wave(ms = 2200) {
  waving = true;
  mood = "happy";
  to("owl.rise", 1, 450, ease.out);
  to("owl.arm", 1, 520, ease.spring);
  await hold(ms);
  waving = false;
  if (mood === "happy") mood = "open";
  to("owl.arm", 0, 380, ease.inOut);
  to("owl.rise", 0, 420, ease.inOut);
}

export function setMood(m: Mood) { mood = m; }

export async function point(text: string, at: Anchor) {
  const el = typeof at === "function" ? at() ?? null : document.querySelector(at);
  pointAt(el);
  await say(text);
  relax();
}

export function quiet() {
  to("guide.o", 0, 300, ease.out);
}

const SIZE = 130;
const hidden = new URLSearchParams(location.search).has("noguide");
let owlAt = { x: 0, y: 0 };
export const owlPosition = () => owlAt;

export function stagePoint(el: Element) {
  const stage = flat(() => document.getElementById("stage")!.getBoundingClientRect());
  const r = flat(() => el.getBoundingClientRect());
  const k = stage.width / W;
  return { x: (r.left + r.width / 2 - stage.left) / k, y: (r.top + r.height / 2 - stage.top) / k };
}

/** Spring motion, segway lean, gaze and blink: shared by Gryt and the friends who arrive. */
export function useFloat(target: { x: number; y: number }, k = 5, snap = 0) {
  const pos = useRef<{ x: number; y: number } | null>(null);
  const vel = useRef({ x: 0, y: 0 });
  const lean = useRef(0);
  const last = useRef(performance.now());
  const snapped = useRef(snap);
  if (!pos.current || snapped.current !== snap) { pos.current = { ...target }; vel.current = { x: 0, y: 0 }; snapped.current = snap; }
  const now = performance.now();
  const dt = Math.min(0.05, (now - last.current) / 1000);
  last.current = now;
  if (dt > 0) {
    const c = 2 * Math.sqrt(k);
    const ax = k * (target.x - pos.current.x) - c * vel.current.x;
    const ay = k * (target.y - pos.current.y) - c * vel.current.y;
    vel.current.x += ax * dt; vel.current.y += ay * dt;
    pos.current.x += vel.current.x * dt; pos.current.y += vel.current.y * dt;
    // Leans into the direction of travel, like flying, with a kick from the acceleration on top.
    lean.current += (Math.max(-18, Math.min(18, vel.current.x * 0.012 + ax * 0.004)) - lean.current) * Math.min(1, dt * 10);
  }
  return { pos: pos.current, vel: vel.current, lean: lean.current };
}

/** The Gryt owl in its circle, at the spot Sivert gave each beat, talking to you. Flat to the screen so it always reads. */
export function Guide() {
  useFrame();
  const look = useRef({ x: 0, y: 0 });
  const lastAim = useRef(0);
  const { pos, vel, lean } = useFloat(spot, stiff, snapN);
  const o = get("guide.o", 0);
  const pop = get("guide.pop", 1);
  // Looks where it points, else where it is going, else at the cursor, with a glance elsewhere every 6s.
  const t = performance.now();
  const cur = { x: get("cur.x", 2100) - pos.x, y: get("cur.y", 1200) - pos.y };
  // A target that has left the page (a dialog that closed) measures as the corner; keep the last aim instead.
  const live = pointTarget?.isConnected && pointTarget.getBoundingClientRect().width > 0;
  const pt = pointTarget && live ? stagePoint(pointTarget) : null;
  const fresh = lastNew && t - lastNew.at < 1600 && lastNew.el.isConnected ? lastNew.el : null;
  const watched = gaze?.isConnected ? gaze : fresh;
  const gz = watched ? stagePoint(watched) : null;
  const toward = waving ? { x: 1, y: -0.2 } : pt ? { x: pt.x - pos.x, y: pt.y - pos.y } : gz ? { x: gz.x - pos.x, y: gz.y - pos.y } : cur;
  const d = Math.hypot(toward.x, toward.y) || 1;
  const g = t % 6000;
  const glance = !pt && !gz && !waving && g > 4600 && g < 5600 ? [{ x: -0.9, y: -0.3 }, { x: 0.2, y: -0.8 }, { x: -0.6, y: 0.3 }][Math.floor(t / 6000) % 3] : null;
  const want = glance ?? { x: toward.x / d, y: Math.max(-0.4, Math.min(0.4, toward.y / d)) };
  const speed = Math.hypot(vel.x, vel.y);
  // Travel only steers the eyes when there is nothing to point at or watch.
  const m = pt || gz ? 0 : Math.min(1, speed / 300);
  const go = { x: vel.x / (speed || 1), y: Math.max(-0.5, Math.min(0.5, vel.y / (speed || 1))) };
  look.current.x += (want.x * (1 - m) + go.x * m - look.current.x) * 0.08;
  look.current.y += (want.y * (1 - m) + go.y * m - look.current.y) * 0.08;
  // Holds the last aim while the arm tucks away, so it never swaps to the other wing mid-retract.
  if (pt) lastAim.current = (Math.atan2(pt.y - pos.y, pt.x - pos.x) * 180) / Math.PI;
  const aim = waving ? -40 + 22 * Math.sin(t / 140) : lastAim.current;
  // Syllable rhythm: two sines out of step, so it never reads as a metronome.
  const talking = t < talkingUntil;
  const beak = talking ? Math.max(0, Math.sin(t / 55) * 0.6 + Math.sin(t / 37) * 0.4) : 0;
  owlAt = { x: Math.round(pos.x), y: Math.round(pos.y) };
  if (hidden) return null;
  const grow = get("owl.scale", 1);
  return (
    <div style={{ position: "absolute", left: pos.x, top: pos.y, zIndex: 45, opacity: o, pointerEvents: "none", visibility: o <= 0.001 ? "hidden" : "visible" }}>
      {get("owl.aura", 0) > 0.01 && (
        <div style={{ position: "absolute", left: -SIZE, top: -SIZE, width: SIZE * 2, height: SIZE * 2, borderRadius: 999, opacity: get("owl.aura") * 0.9,
          transform: `scale(${(0.85 + 0.08 * Math.sin(t / 420)) * grow})`, background: "radial-gradient(circle, color-mix(in oklab, var(--gryt-accent-9) 45%, transparent) 0%, transparent 62%)" }} />
      )}
      <div style={{ position: "absolute", left: -SIZE / 2, top: -SIZE / 2, transform: `rotate(${lean + get("owl.tilt", 0)}deg) scale(${grow})`, transformOrigin: "50% 50%" }}>
        <Owl size={SIZE} wear={worn} pose={{ beak, blink: blinkAt(t), mood, lookX: look.current.x, lookY: look.current.y, rise: get("owl.rise", 0), shift: Math.max(-1, Math.min(1, vel.x / 500)), paws: get("owl.paws", 1), arm: get("owl.arm", 0), aim, side: waving ? "right" : pointSide }} />
      </div>
      {line.text && pop > 0.01 && (
        <div
          key={line.n}
          style={{
            // Above the owl: its bottom sits just over the head, however many lines it has. Beside: placed by its top.
            position: "absolute", left: -SIZE / 2 + bubble.dx, ...(bubble.dy < -40 ? { bottom: (SIZE / 2) * get("owl.scale", 1) + 4 } : { top: -SIZE / 2 + bubble.dy }), width: "max-content", maxWidth: 240,
            transformOrigin: "50% 100%", transform: `scale(${0.6 + 0.4 * pop})`, opacity: Math.min(1, pop * 1.5),
            padding: "9px 13px", borderRadius: 16, background: "var(--gryt-neutral-12)", color: "var(--gryt-neutral-1)",
            fontSize: 17, fontWeight: 700, lineHeight: 1.3, letterSpacing: "-0.01em", boxShadow: "0 18px 50px rgba(0,0,0,.4)",
          }}
        >
          {line.text}
        </div>
      )}
    </div>
  );
}

/** A friend arriving: the same ring and float as Gryt, with their own owl in it, waving back. */
export function FriendOwl({ id, src, from, to: dest, born }: { id: string; src: string; from: { x: number; y: number }; to: { x: number; y: number }; born: number }) {
  useFrame();
  const t = performance.now() - born;
  // Pops in beside its member row, waves for a while, then shrinks into the row.
  const leaving = t > 2600;
  const target = leaving ? dest : from;
  const { pos, lean } = useFloat(target);
  const grow = Math.min(1, ease.spring(Math.min(1, t / 700))) * (leaving ? Math.max(0, 1 - (t - 2600) / 500) : 1);
  const rise = t < 500 ? -1 : t < 1000 ? -0.55 : 0;
  const wavingNow = t > 1100 && t < 2500;
  if (grow <= 0.01) return null;
  return (
    <div style={{ position: "absolute", left: pos.x, top: pos.y, zIndex: 44, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: -48, top: -48, transform: `rotate(${lean}deg) scale(${grow})` }}>
        <Owl id={id} size={96} inner={src} mirrored pose={{ lookX: -0.6, lookY: 0, rise: rise === 0 && wavingNow ? 1 : rise, paws: t > 900 ? 1 : 0, arm: wavingNow ? 1 : 0, aim: -40 + 22 * Math.sin(t / 140), blink: blinkAt(t + 900) }} />
      </div>
    </div>
  );
}
