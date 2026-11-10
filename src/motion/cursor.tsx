import { pointAt, relax, setMood } from "./guide";
import { sfx } from "./sfx";
import { type Boxed, centerOf, ease, flat, get, set, TEMPO, to, useFrame, wait } from "./stage";

export function Cursor() {
  useFrame();
  const x = get("cur.x", 2100);
  const y = get("cur.y", 1200);
  const ring = get("cur.ring", 0);
  const dbg = new URLSearchParams(location.search).has("dbg");
  return (
    <>
      {dbg && <div style={{ position: "absolute", left: get("dbg.x") - 6, top: get("dbg.y") - 6, width: 12, height: 12, borderRadius: 99, background: "red", zIndex: 99 }} />}
      {get("force", 0) > 0.01 && (
        <>
          <div style={{ position: "absolute", left: x - 70, top: y - 70, width: 140, height: 140, borderRadius: 999, pointerEvents: "none", zIndex: 49, opacity: get("force") * 0.9, background: "radial-gradient(circle, color-mix(in oklab, var(--gryt-accent-9) 55%, transparent) 0%, transparent 65%)" }} />
          <div style={{ position: "absolute", left: x - 45, top: y - 45, width: 90, height: 90, borderRadius: 999, pointerEvents: "none", zIndex: 49, border: "3px solid var(--gryt-accent-10)", opacity: get("force"), transform: `scale(${2.2 - 1.6 * get("force")})` }} />
        </>
      )}
      <div
        style={{
          position: "absolute", left: x, top: y, width: 90, height: 90, margin: "-45px 0 0 -45px", borderRadius: 999,
          border: "4px solid var(--gryt-accent-10)", opacity: ring > 0 && ring < 1 ? 1 - ring : 0,
          transform: `scale(${0.2 + ring * 1.1})`, pointerEvents: "none", zIndex: 50,
        }}
      />
    </>
  );
}

export async function moveTo(el: Boxed | { x: number; y: number }, dur = 700, dx = 0.5, dy = 0.5) {
  // Re-aimed every frame, so a target that moves with the camera is still where the cursor lands.
  const aim = () => ("getBoundingClientRect" in el ? centerOf(el, dx, dy) : el);
  const sx = get("cur.x", 2100), sy = get("cur.y", 1200);
  const start = performance.now();
  for (;;) {
    const p = Math.min(1, (performance.now() - start) / (dur * TEMPO));
    const t = aim(), e = ease.inOut(p);
    set("cur.x", sx + (t.x - sx) * e);
    set("cur.y", sy + (t.y - sy) * e);
    if (p >= 1) break;
    await new Promise((r) => requestAnimationFrame(r));
  }
}

export async function click(el?: HTMLElement, dur = 700) {
  if (el) {
    // A dialog taller than the screen scrolls; bring the target into its view first, the way a person would.
    el.scrollIntoView({ block: "nearest" });
    // Gryt uses the force: eyes shut, wing out, and a glow gathers on the target before it presses.
    pointAt(el);
    await moveTo(el, 1);
    setMood("focus");
    set("force", 0);
    sfx("force");
    to("force", 1, Math.min(520, dur * 0.8), ease.inOut);
    await wait(Math.min(520, dur * 0.8));
    setTimeout(() => relax(el), 500);
    // What is really under the cursor tip: anything else means the click lands on empty space.
    const stack = flat(() => {
      const stage = document.getElementById("stage")!.getBoundingClientRect();
      const k = stage.width / 1920;
      return document.elementsFromPoint(stage.left + get("cur.x") * k, stage.top + get("cur.y") * k);
    });
    const hit = stack[0];
    if (!stack.some((h) => el.contains(h) || (h.contains(el) && h.tagName === "BUTTON"))) {
      console.error(`motion: t=${(performance.now() / 1000).toFixed(2)} click missed "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}", cursor is over <${hit?.tagName.toLowerCase()} ${hit?.className?.toString().slice(0, 40) ?? ""}>`);
    }
  }
  to("cur.press", 1, 90);
  await wait(74);
  sfx("click");
  await wait(16);
  set("cur.ring", 0);
  to("cur.ring", 1, 520, ease.out);
  el?.focus?.();
  if (typeof el?.click === "function") el.click();
  else el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  to("cur.press", 0, 140);
  to("force", 0, 260, ease.out);
  setMood("open");
  await wait(160);
}

/** A force tap that only hovers: what brings a message's reaction bar up. */
export async function touch(el: HTMLElement, dur = 520) {
  pointAt(el);
  await moveTo(el, 1);
  setMood("focus");
  set("force", 0);
  sfx("force");
  to("force", 1, Math.min(520, dur * 0.8), ease.inOut);
  await wait(Math.min(520, dur * 0.8));
  sfx("click");
  set("cur.ring", 0);
  to("cur.ring", 1, 520, ease.out);
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: document.body }));
  to("force", 0, 260, ease.out);
  setMood("open");
  setTimeout(() => relax(el), 500);
  await wait(160);
}
