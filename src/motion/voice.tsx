import { avatarSeed, owlAvatarColour } from "@gryt/owl";
import { Avatar } from "@gryt/ui";
import { useEffect, useRef, useState } from "react";

import { avatarOf } from "./examples";
import { blinkAt, isTalking } from "./guide";
import { parse } from "./liveOwl";
import { Owl } from "./owl";
import { get, useFrame } from "./stage";
import { worn } from "./wardrobe";
import { speakingRingStyle, tileGradientFrom, tileHue, tileTint } from "../packages/socket/src/components/speakingIndicator";
import { TILE_RADIUS, VideoCard } from "../packages/socket/src/components/VoiceParticipantCard";

const CAM_W = 640, CAM_H = 360;

/** A repeatable 0–1 from a string, so every render and every slice agrees. */
function rnd(s: string) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Turns of 1.6–3.8 s with short gaps between, one voice at a time, never the same person twice running. */
const turns: { who: number; from: number; to: number }[] = [];
function turnAt(t: number, n: number) {
  while (!turns.length || turns[turns.length - 1].to < t) {
    const i = turns.length, prev = turns[i - 1];
    const from = (prev?.to ?? 0) + 250 + 600 * rnd(`gap${i}`);
    const who = ((prev?.who ?? 0) + 1 + Math.floor(rnd(`who${i}`) * (n - 1))) % n;
    turns.push({ who, from, to: from + 1600 + 2200 * rnd(`len${i}`) });
  }
  return turns.find((u) => t >= u.from && t < u.to) ?? null;
}

/** How open the beak is: syllables at about 4 a second, with short pauses between words. */
function mouth(t: number, phase: number) {
  if (rnd(`w${Math.floor(t / 420)}${phase}`) < 0.22) return 0;
  return Math.max(0, Math.sin((t / 1000) * Math.PI * 2 * 4.2 + phase));
}

/** Where an owl looks: it holds a point for 1.2–3 s, then darts to the next, often toward whoever is talking. */
function gaze(name: string, t: number, toward: number | null) {
  let at = 0, k = 0;
  for (;; k++) { const len = 1200 + 1800 * rnd(`${name}g${k}`); if (at + len > t) break; at += len; }
  const target = (i: number) => (toward !== null && rnd(`${name}t${i}`) < 0.55 ? { x: toward, y: 0.1 } : { x: rnd(`${name}x${i}`) * 2 - 1, y: rnd(`${name}y${i}`) - 0.5 });
  const a = target(k - 1), b = target(k), e = Math.min(1, (t - at) / 220);
  const s = e * e * (3 - 2 * e);
  return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, happy: rnd(`${name}h${k}`) < 0.22 };
}

/** The blurred room behind a camera owl, in their own colour. */
function useRoom(name: string): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = CAM_W; c.height = CAM_H;
    canvas.current = c;
    setStream(c.captureStream(30));
  }, [name]);
  const c = canvas.current;
  if (c) {
    const g = c.getContext("2d")!;
    const t = performance.now() / 1000;
    g.filter = "blur(28px)";
    g.fillStyle = "#1a1b22"; g.fillRect(0, 0, CAM_W, CAM_H);
    g.fillStyle = name === "Gryt" ? "#3b3480" : owlAvatarColour(avatarSeed(name) ?? name); g.globalAlpha = 0.55;
    g.beginPath(); g.arc(120 + 20 * Math.sin(t / 3), 90, 150, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#e9d8b4"; g.globalAlpha = 0.25;
    g.fillRect(430, 40, 150, 210);
    g.globalAlpha = 1; g.filter = "none";
  }
  return stream;
}

function FriendOwl({ name, look, blink, open, happy }: { name: string; look: { x: number; y: number }; blink: number; open: number; happy: boolean }) {
  const o = parse(name);
  const lx = 34 * look.x, ly = 16 * look.y;
  const beak = o.features.length - 1;
  return (
    <svg viewBox="-60 120 1144 1144" width="100%" height="100%" style={{ overflow: "visible" }}>
      {o.body.map((p, i) => <path key={i} d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />)}
      {o.wing && <path d={o.wing.d} fill={o.wing.fill} />}
      {o.face && <path d={o.face.d} fill={o.face.fill} transform={`translate(${lx * 0.5} ${ly * 0.5})`} />}
      <g transform={`translate(${lx} ${ly})`}>
        {o.features.map((p, i) => (p.eye && happy ? null : (
          <path
            key={i} d={p.d} fill={p.fill}
            style={p.eye ? { transformBox: "fill-box", transformOrigin: "center", transform: `scaleY(${1 - 0.9 * blink})` }
              : i === beak ? { transformBox: "fill-box", transformOrigin: "top", transform: `scaleY(${1 + 0.35 * open})` } : undefined}
          />
        )))}
        {happy && o.eyes.map((c, i) => (
          <path key={`h${i}`} d={`M${c.x - 52} ${c.y + 18}Q${c.x} ${c.y - 46} ${c.x + 52} ${c.y + 18}`} fill="none" stroke={o.features.find((f) => f.eye)!.fill} strokeWidth="30" strokeLinecap="round" />
        ))}
      </g>
      {o.extra.map((p, i) => <path key={`x${i}`} d={p.d} fill={p.fill} stroke={p.stroke} strokeWidth={p.strokeWidth} />)}
    </svg>
  );
}

function Cam({ name, speaking, open, toward }: { name: string; speaking: boolean; open: number; toward: number | null }) {
  const stream = useRoom(name);
  const t = performance.now(), ph = name.length;
  const g = gaze(name, t, speaking ? null : toward);
  const happy = g.happy && !speaking;
  const blink = blinkAt(t + ph * 731);
  const bob = Math.sin((t / 1000) * 1.3 + ph) * 1.6, sway = Math.sin((t / 1000) * 0.7 + ph) * 2.3;
  return (
    // Drawn live over the room rather than into the canvas, which is too slow to decode a new SVG for every frame.
    // It goes in the badge slot, the one layer VideoCard paints between the video and the name.
    <VideoCard stream={stream} nickname={name} isSpeaking={speaking} mutedBadge={
      <div style={{ position: "absolute", left: "50%", bottom: `${-11 + bob}%`, height: "83%", aspectRatio: "1", transform: `translateX(-50%) rotate(${sway}deg)`, pointerEvents: "none" }}>
        {name === "Gryt" ? (
          <svg viewBox="63 369 1144 1144" width="100%" height="100%" style={{ overflow: "visible" }}>
            <Owl id="cam-gryt" size={1269} bare wear={worn} pose={{ lookX: 0.7 * g.x, lookY: 0.5 * g.y, rise: 0, arm: 0, aim: 0, paws: 0, blink, beak: open, mood: happy ? "happy" : "open" }} />
          </svg>
        ) : (
          <FriendOwl name={name} look={g} blink={blink} open={open} happy={happy} />
        )}
      </div>
    } />
  );
}

/** Somebody with a picture and the camera off: the call's own avatar tile. */
function AvatarTile({ name, src, speaking, small }: { name: string; src: string; speaking: boolean; small: boolean }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: TILE_RADIUS, overflow: "hidden", background: tileGradientFrom(tileTint(name)), display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Avatar size="medium" fallback={name[0]} src={src} style={{ ...speakingRingStyle(tileHue(name), speaking), width: small ? 32 : 72, height: small ? 32 : 72 }} />
      <span className="font-medium truncate" style={{ position: "absolute", bottom: small ? 6 : 9, left: small ? 8 : 12, color: "#fff", fontSize: small ? 12 : 16, lineHeight: 1.2 }}>{name}</span>
    </div>
  );
}

const render = new URLSearchParams(location.search).has("render");

/** A screen share from a clip: in a render it is seeked to the film's clock each frame, so it never stutters. */
function useClipShare(src: string): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => {
    const v = document.createElement("video");
    v.src = src; v.muted = true; v.playsInline = true; v.preload = "auto";
    const c = document.createElement("canvas");
    c.width = 1280; c.height = 720;
    const g = c.getContext("2d")!;
    const born = performance.now();
    const draw = () => g.drawImage(v, 0, 0, c.width, c.height);
    setStream(c.captureStream(60));
    if (!render) { v.loop = true; void v.play(); const id = setInterval(draw, 16); return () => clearInterval(id); }
    const w = window as unknown as { __beforeShot?: () => Promise<void> };
    const prev = w.__beforeShot;
    w.__beforeShot = async () => {
      await prev?.();
      if (!v.duration) return;
      v.currentTime = ((performance.now() - born) / 1000) % v.duration;
      await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
      draw();
    };
    return () => { w.__beforeShot = prev; };
  }, [src]);
  return stream;
}

// The stream quality pill from client#1173 (StreamQualityPill.tsx), drawn with the film's numbers:
// the real one reads getStats from the SFU, which the film doesn't have.
const ON_VIDEO = { glass: "rgba(17,19,24,.8)", text: "#e0e0e6", fpsBg: "#2b2a47", fps: "#c3c1ff" };
const DETAILS: [string, string][] = [
  ["Size", "1920 × 1080"], ["Frame rate", "240 fps"], ["Codec", "AV1"], ["Bitrate", "18.2 Mbit/s"],
  ["Packet loss", "0.3%"], ["Dropped frames", "0.0%"], ["Jitter", "4 ms"], ["Freezes", "none"],
];

function QualityPill() {
  const open = get("pill.tip", 0);
  return (
    <>
      <button id="share-pill" type="button" className="absolute left-2.5 top-2.5 flex cursor-pointer items-center overflow-hidden rounded-full border-0 p-0 text-xs font-semibold"
        style={{ background: ON_VIDEO.glass, fontFamily: "var(--font-mono)", lineHeight: "18px", zIndex: 2 }}>
        <span style={{ padding: "2px 6px 2px 9px", color: ON_VIDEO.text }}>1080p</span>
        <span style={{ padding: "2px 9px 2px 6px", background: ON_VIDEO.fpsBg, color: ON_VIDEO.fps }}>240 fps</span>
      </button>
      {open > 0.01 && (
        <div className="gryt-tooltip rounded-(--gryt-radius-md) border border-gryt-border bg-gryt-surface-raised px-2.5 py-1.5 text-xs text-gryt-text"
          style={{ position: "absolute", left: 10, top: 40, zIndex: 3, opacity: open, transform: `scale(${0.96 + 0.04 * open})`, transformOrigin: "top left" }}>
          <div className="grid gap-x-3 gap-y-0.5 text-xs" style={{ gridTemplateColumns: "auto auto" }}>
            {DETAILS.map(([label, value]) => (
              <div key={label} className="contents">
                <span style={{ color: "var(--gryt-neutral-11)" }}>{label}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Share({ src, title }: { src: string; title: string }) {
  const stream = useClipShare(src);
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <VideoCard stream={stream} nickname={title} objectFit="contain" />
      <QualityPill />
    </div>
  );
}

/** The lounge's call: one tile per person, taking turns to talk, and a screen share on top when there is one. */
// Everyone joins on their avatar; a name in `cams` has turned its camera on, which fades in over the avatar.
export function VoiceGrid({ people, cams, share }: { people: string[]; cams: string[]; share?: { src: string; title: string } | null }) {
  useFrame();
  const born = useRef(performance.now());
  const camOn = useRef<Record<string, number>>({});
  for (const n of cams) camOn.current[n] ??= performance.now();
  const t = performance.now() - born.current;
  // While Gryt has a line up he is the one talking, and the others listen.
  const others = people.filter((n) => n !== "Gryt");
  const turn = isTalking() ? null : turnAt(t, others.length);
  const speaker = isTalking() ? "Gryt" : turn ? others[turn.who] : null;
  const at = speaker ? people.indexOf(speaker) : -1;
  const tiles = people.map((n, i) => {
    const speaking = n === speaker;
    const on = camOn.current[n];
    const fade = on === undefined ? 0 : Math.min(1, (performance.now() - on) / 350);
    return (
      <div key={n} style={{ aspectRatio: "16 / 9", position: "relative" }}>
        {fade < 1 && <AvatarTile name={n} src={avatarOf(n)} speaking={speaking} small={!!share} />}
        {on !== undefined && (
          <div style={{ position: "absolute", inset: 0, opacity: fade }}>
            <Cam name={n} speaking={speaking} open={speaking ? mouth(t, i * 1.7) : 0} toward={at < 0 || at === i ? null : Math.sign(at - i)} />
          </div>
        )}
      </div>
    );
  });
  if (share) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", justifyContent: "center" }}>
        <div style={{ aspectRatio: "16 / 9", width: "100%" }}><Share src={share.src} title={share.title} /></div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${people.length}, minmax(0, 1fr))`, gap: 8 }}>{tiles}</div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${people.length <= 4 ? 2 : 3}, minmax(0, 1fr))`, gap: 8, height: "100%", alignContent: "center" }}>{tiles}</div>
  );
}
