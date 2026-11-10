import { type Accessory, ACCESSORIES, owlPalette } from "@gryt/owl";

import { owlPosition, pointAt, relax, say, setMood, wave } from "./guide";
import { Owl } from "./owl";
import { sfx } from "./sfx";
import { ease, get, hold, set, to, useFrame, wait } from "./stage";

const PAL: Record<string, string> = { ...owlPalette("violet", "day"), body: "#A495E3", face: "#B5A8E6", accent: "#2E2D5F", wing: "#7C6EC3", background: "#2E2D5F" };
// Every cosmetic there is except the expressions, which are faces rather than things to put on.
const RACK = ACCESSORIES.filter((a) => a.slot !== "expression") as Accessory[];
export const worn: Accessory[] = [];
let flying: { i: number; born: number } | null = null;

/** An accessory on Gryt's 1269 frame: the 1024 avatar frame shifted so the eyes line up. */
export function AccessoryPaths({ acc }: { acc: Accessory }) {
  return (
    <g transform="translate(123 249)">
      {acc.paths.map((p, i) => (
        <path
          key={i} d={p.d} fill={p.fill ? PAL[p.fill] : "none"} stroke={p.stroke ? PAL[p.stroke] : undefined}
          strokeWidth={p.strokeWidth} strokeLinecap={p.linecap} strokeLinejoin={p.linejoin} fillRule={p.evenodd ? "evenodd" : undefined}
        />
      ))}
    </g>
  );
}

/** Where an accessory sits on Gryt's frame, padded, for framing it alone on the rack. */
function box(acc: Accessory) {
  const n = acc.paths.flatMap((p) => p.d.match(/-?\d+(\.\d+)?/g)!.map(Number));
  const xs = n.filter((_, i) => i % 2 === 0).map((v) => v + 123), ys = n.filter((_, i) => i % 2 === 1).map((v) => v + 249);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys), side = Math.max(w, h) * 1.15;
  return `${(Math.min(...xs) + Math.max(...xs) - side) / 2} ${(Math.min(...ys) + Math.max(...ys) - side) / 2} ${side} ${side}`;
}

const ITEM = 92;
const INNER = 18;
const CY = 540;
/** Two slow rings around Gryt: the inner one turns one way, the outer the other. */
const slot = (i: number) => {
  const inner = i < INNER, n = inner ? INNER : RACK.length - INNER, k = inner ? i : i - INNER;
  const r = inner ? 300 : 440, a = (k / n) * Math.PI * 2 + ((inner ? 1 : -1) * performance.now()) / 24000;
  return { x: Math.cos(a) * r, y: CY + Math.sin(a) * r * 0.82 };
};

/** The rack above Gryt and the mirror beside him, out in the open past the app. */
export function Wardrobe() {
  useFrame();
  const x = get("wr.x", 4000);
  if (x > 3000) return null;
  const t = performance.now();
  const o = owlPosition();
  const grow = get("owl.scale", 1);
  return (
    <>
      {RACK.map((acc, i) => {
        const picked = worn.includes(acc) || flying?.i === i;
        const at = slot(i);
        // They pop in one after another as Gryt arrives, and fade together before the mirror.
        const pop = Math.min(1, ease.spring(Math.max(0, Math.min(1, (t - get("wr.born", 0) - i * 22) / 400))));
        return (
          <svg key={acc.name} id={`wr-item-${i}`} width={ITEM} height={ITEM} viewBox={box(acc)} style={{ position: "absolute", left: x + at.x - ITEM / 2, top: at.y - ITEM / 2, zIndex: 41, opacity: (picked ? 0.15 : 1) * get("wr.ring", 1), transform: `scale(${pop})` }}>
            <AccessoryPaths acc={acc} />
          </svg>
        );
      })}
      {flying && (() => {
        const p = Math.min(1, (t - flying.born) / 750);
        const e = ease.inOut(p);
        const from = { x: x + slot(flying.i).x, y: slot(flying.i).y };
        // Drawn on the owl's own frame at the owl's size, so it lands exactly where it is worn.
        const s = 0.75 + (grow - 0.75) * e;
        const cx = from.x + (o.x - from.x) * e, cy = from.y + (o.y - from.y) * e - Math.sin(p * Math.PI) * 60;
        return (
          <svg width={ITEM * s} height={ITEM * s} viewBox="0 0 1269 1269" style={{ position: "absolute", left: cx - (ITEM * s) / 2, top: cy - (ITEM * s) / 2, zIndex: 47, overflow: "visible", filter: "drop-shadow(0 0 18px color-mix(in oklab, var(--gryt-accent-9) 60%, transparent))" }}>
            <AccessoryPaths acc={RACK[flying.i]} />
          </svg>
        );
      })()}
      <div style={{ position: "absolute", left: x + 330, top: 400, width: 210, height: 300, borderRadius: 105, border: "10px solid var(--gryt-neutral-7)", background: "linear-gradient(160deg, var(--gryt-neutral-4), var(--gryt-neutral-2))", overflow: "hidden", zIndex: 40, opacity: get("wr.mirror", 0) }}>
        <div style={{ position: "absolute", left: 15, top: 70 }}>
          <Owl id="mirror" size={160} mirrored pose={{ lookX: 0.6, lookY: 0, rise: 0, arm: 0, aim: 0, mood: get("wr.happy", 0) > 0.5 ? "happy" : "open", blink: 0 }} wear={worn} />
        </div>
      </div>
    </>
  );
}

async function pick(i: number) {
  const el = document.getElementById(`wr-item-${i}`)!;
  const r = el.getBoundingClientRect();
  const stage = document.getElementById("stage")!.getBoundingClientRect();
  const k = stage.width / 1920;
  set("cur.x", (r.left + r.width / 2 - stage.left) / k);
  set("cur.y", (r.top + r.height / 2 - stage.top) / k);
  pointAt(el);
  setMood("focus");
  set("force", 0);
  sfx("force");
  to("force", 1, 500, ease.inOut);
  await wait(520);
  to("force", 0, 260, ease.out);
  sfx("whoosh", { dur: 750 });
  flying = { i, born: performance.now() };
  await wait(760);
  flying = null;
  // Same slot: the old one goes back on the rack.
  const clash = worn.findIndex((w) => w.slot === RACK[i].slot);
  if (clash >= 0) worn.splice(clash, 1);
  worn.push(RACK[i]);
  sfx("dress");
  relax();
  setMood("open");
  await hold(250);
}

/** Gryt flies out past the app, dresses from the rack with the force, checks the mirror, and flies back. */
export async function dressUp(back: () => Promise<void>, out: () => void) {
  await say("Everyone's in the lounge. We should join them!", undefined, undefined, "happy");
  const first = say("But first, I need to get dressed.");
  await hold(700);
  setMood("open");
  out();
  set("wr.x", 2900);
  set("wr.ring", 1);
  set("wr.born", performance.now() + 700);
  to("wr.x", 900, 1400, ease.inOut);
  to("owl.scale", 1.5, 1400, ease.inOut);
  await hold(1300);
  await first;
  const at = (n: string) => RACK.findIndex((a) => a.name === n);
  // Straight to the look he wants: bucket hat, ski goggles, scarf.
  for (const n of ["hat-bucket-large", "glasses-military-skigoggles", "necklace-scarf"]) await pick(at(n));
  // The mirror and the line land together.
  to("wr.ring", 0, 400, ease.out);
  to("wr.mirror", 1, 400, ease.out);
  set("wr.happy", 1);
  void wave(1500);
  void say("Now I'm ready!", undefined, undefined, "happy");
  await hold(1200);
  to("wr.x", 2900, 1400, ease.inOut);
  to("owl.scale", 1, 1400, ease.inOut);
  await back();
}
