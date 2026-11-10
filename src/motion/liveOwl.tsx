import { avatarSeed, decodeWorn, owlAvatarSvg, owlPartPaths, resolveOwl, wornToOptions } from "@gryt/owl";
import { useRef } from "react";
import { createPortal } from "react-dom";

import { blinkAt, owlPosition } from "./guide";
import { Owl } from "./owl";
import { CUSTOM_OWLS, FRIENDS, hasPicture } from "./people";
import { ease, useFrame } from "./stage";

type P = { d: string; fill: string; stroke?: string; strokeWidth?: string };
type Parsed = { bg: string; body: P[]; face: P | null; features: (P & { eye?: boolean })[]; extra: P[]; wing: P | null; eyes: { x: number; y: number }[] };

const cache = new Map<string, Parsed>();

function bbox(d: string) {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Splits the avatar's own SVG into parts by matching it against owlPartPaths, so accessories and ear styles stay right. */
export function parse(name: string): Parsed {
  const hit = cache.get(name);
  if (hit) return hit;
  const seed = avatarSeed(name)!;
  const look = decodeWorn(FRIENDS.find((f) => f.nickname === name)?.avatarWorn ?? null);
  const opts = look ? wornToOptions(look) : undefined;
  const svg = CUSTOM_OWLS[name] ?? owlAvatarSvg(seed, opts);
  const attr = (tag: string, k: string) => tag.match(new RegExp(` ${k}="([^"]*)"`))?.[1];
  const paths: P[] = [...svg.matchAll(/<path [^>]*>/g)].map(([tag]) => ({ d: attr(tag, "d")!, fill: attr(tag, "fill") ?? "none", stroke: attr(tag, "stroke"), strokeWidth: attr(tag, "stroke-width") }));
  const parts = owlPartPaths(resolveOwl(seed, opts) as never);
  const at = (part: string) => paths.findIndex((p) => p.d === parts.find((q) => q.part === part)?.d);
  const face = at("face"), beak = at("beak"), wing = at("wingRight");
  const eyeDs = new Set(parts.filter((q) => q.part === "eyeLeft" || q.part === "eyeRight").map((q) => q.d));
  const features = paths.slice(face + 1, beak + 1).map((p) => ({ ...p, eye: eyeDs.has(p.d) }));
  const out: Parsed = {
    bg: svg.match(/<rect[^>]*fill="([^"]+)"/)?.[1] ?? "#333",
    body: paths.slice(0, face).filter((_, i) => i !== wing),
    face: paths[face] ?? null,
    features,
    extra: paths.slice(beak + 1),
    wing: paths[wing] ?? null,
    eyes: features.filter((f) => f.eye).map((f) => bbox(f.d)),
  };
  cache.set(name, out);
  return out;
}

/** A member's own owl, alive: looks around, blinks, and on arrival pops in, smiles and waves. */
export function LiveOwl({ name, size, born, gaze }: { name: string; size: number; born: number; gaze?: { x: number; y: number } }) {
  useFrame();
  const t = performance.now();
  // You are Gryt in the film, so your row shows the guide owl itself.
  if (name === "Gryt") return <div style={{ position: "absolute", inset: 0 }}><Owl id="me-owl" size={size} pose={{ lookX: 0.4 * Math.sin(t / 1900), lookY: 0, rise: 0, arm: 0, aim: 0, paws: 0, blink: blinkAt(t + 500) }} /></div>;
  const o = parse(name);
  const age = t - born;
  const phase = (name.charCodeAt(0) * 37) % 100;
  const pop = Math.min(1, ease.spring(Math.min(1, age / 550)));
  // On a card: no hello wave, a slow turn toward Gryt, then a smile.
  const waving = !gaze && age > 350 && age < 2600;
  const happy = gaze ? age > 1500 : age > 250 && age < 3000;
  const turn = gaze ? ease.inOut(Math.min(1, Math.max(0, (age - 300) / 1200))) : 0;
  const look = gaze
    ? { x: 40 * gaze.x * turn + 4 * Math.sin(t / 1900), y: 20 * gaze.y * turn }
    : { x: 30 * Math.sin(t / 1900 + phase), y: 12 * Math.sin(t / 2700 + phase * 2) };
  const blink = blinkAt(t + phase * 97);
  const wingA = -172 + 16 * Math.sin(age / 120);
  const id = `lo-${name}`;
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" style={{ position: "absolute", inset: 0, overflow: "visible", transform: `scale(${pop})` }}>
      <defs><clipPath id={id}><circle cx="512" cy="512" r="512" /></clipPath></defs>
      <g clipPath={`url(#${id})`}>
        <rect width="1024" height="1024" fill={o.bg} />
        {o.body.map((p, i) => <path key={i} d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />)}
        {!waving && o.wing && <path d={o.wing.d} fill={o.wing.fill} />}
        {o.face && <path d={o.face.d} fill={o.face.fill} transform={`translate(${look.x * 0.5} ${look.y * 0.5})`} />}
        <g transform={`translate(${look.x} ${look.y})`}>
          {o.features.map((p, i) =>
            p.eye && happy ? null : (
              <path key={i} d={p.d} fill={p.fill} style={p.eye ? { transformBox: "fill-box", transformOrigin: "center", transform: `scaleY(${1 - 0.9 * blink})` } : undefined} />
            ),
          )}
          {happy && o.eyes.map((c, i) => (
            <path key={`h${i}`} d={`M${c.x - 52} ${c.y + 18}Q${c.x} ${c.y - 46} ${c.x + 52} ${c.y + 18}`} fill="none" stroke={o.features.find((f) => f.eye)!.fill} strokeWidth="30" strokeLinecap="round" />
          ))}
        </g>
        {o.extra.map((p, i) => <path key={`x${i}`} d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />)}
      </g>
      {/* Raised, the wing reaches out past the circle, like Gryt's paw over the ring. */}
      {waving && o.wing && <path d={o.wing.d} fill={o.wing.fill} transform={`rotate(${wingA} 907 677)`} />}
    </svg>
  );
}

const firstSeen = new Map<string, number>();

/** Lays a LiveOwl over every avatar in the member list, keyed to the row's name. */
export function LiveMembers({ root = "#s-members" }: { root?: string }) {
  useFrame();
  const seen = useRef(firstSeen);
  const host = document.querySelector(root);
  if (!host) return null;
  const rows = [...host.querySelectorAll<HTMLElement>(".member-row")];
  return (
    <>
      {rows.map((row) => {
        const name = row.querySelector(".text-sm")?.textContent?.trim();
        const avatar = row.querySelector<HTMLElement>("img")?.closest<HTMLElement>("[class*='avatar'], span") ?? null;
        if (!name || !avatar?.parentElement || hasPicture(name)) return null;
        if (!seen.current.has(name)) seen.current.set(name, performance.now());
        const parent = avatar.parentElement;
        parent.style.position = "relative";
        avatar.style.visibility = "hidden";
        return createPortal(
          <div style={{ position: "absolute", left: avatar.offsetLeft, top: avatar.offsetTop, width: avatar.offsetWidth, height: avatar.offsetHeight, pointerEvents: "none" }}>
            <LiveOwl name={name} size={avatar.offsetWidth} born={seen.current.get(name)!} />
          </div>,
          parent,
          name,
        );
      })}
    </>
  );
}

/** The open member card's avatar, alive, turning to look at Gryt. */
export function LiveCard({ name }: { name: string | null }) {
  useFrame();
  const born = useRef<{ name: string | null; at: number }>({ name: null, at: 0 });
  if (born.current.name !== name) born.current = { name, at: performance.now() };
  const img = name ? [...document.querySelectorAll<HTMLImageElement>("#card img")].find((i) => i.offsetWidth > 30 && Math.abs(i.offsetWidth - i.offsetHeight) < 4) : null;
  const avatar = img?.parentElement;
  if (!name || !img || !avatar?.parentElement || hasPicture(name)) return null;
  const r = img.getBoundingClientRect();
  const stage = document.getElementById("stage")!.getBoundingClientRect();
  const k = stage.width / 1920;
  const o = owlPosition();
  const dx = o.x - (r.left + r.width / 2 - stage.left) / k, dy = o.y - (r.top + r.height / 2 - stage.top) / k;
  const d = Math.hypot(dx, dy) || 1;
  img.style.visibility = "hidden";
  const parent = img.parentElement!;
  if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
  return createPortal(
    <div style={{ position: "absolute", left: img.offsetLeft, top: img.offsetTop, width: img.offsetWidth, height: img.offsetHeight, pointerEvents: "none" }}>
      <LiveOwl name={name} size={img.offsetWidth} born={born.current.at} gaze={{ x: dx / d, y: dy / d }} />
    </div>,
    parent,
    `card-${name}`,
  );
}
