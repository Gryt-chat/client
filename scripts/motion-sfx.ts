// Builds the film's sound track from the events motion.html logged. Uses the licensed samples in
// public/motion-assets/sfx (gitignored, see SOURCE.txt there) when present, else synthesises them.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RATE = 48000;

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = () => rnd() * 2 - 1;

/** One-pole lowpass, coefficient from a cutoff in Hz. */
function lowpass(cutoff: number) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  return (x: number) => (y += a * (x - y));
}

function render(len: number, fn: (t: number, i: number) => number) {
  const out = new Float32Array(Math.ceil(len * RATE));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / RATE, i);
  return out;
}

type Voice = (dur?: number) => Float32Array;
const voices: Record<string, Voice> = {
  // A short dry tick: a high sine ping over a 3 ms click of filtered noise.
  click: () => {
    const f = 2300 * (0.95 + rnd() * 0.1);
    const lp = lowpass(6000);
    return render(0.05, (t: number) => 0.32 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.007) + 0.5 * lp(noise()) * Math.exp(-t / 0.0018));
  },
  // A soft keycap: darker and much quieter, pitch varied so a run of them isn't a machine gun.
  key: () => {
    const f = 900 + rnd() * 500;
    const lp = lowpass(3200);
    const g = 0.6 + rnd() * 0.4;
    return render(0.04, (t: number) => g * (0.09 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.004) + 0.22 * lp(noise()) * Math.exp(-t / 0.0025)));
  },
  // Something lands: a sine falling an octave, rounded off fast.
  pop: () => {
    const f0 = 560 * (0.92 + rnd() * 0.16);
    let ph = 0;
    return render(0.16, (t: number) => {
      const f = f0 * Math.pow(0.5, Math.min(1, t / 0.07));
      ph += (2 * Math.PI * f) / RATE;
      const env = Math.min(1, t / 0.002) * Math.exp(-t / 0.045);
      return 0.2 * env * (Math.sin(ph) + 0.18 * Math.sin(2 * ph));
    });
  },
  // Air past the camera: noise through a filter that opens and closes with the move.
  whoosh: (dur = 600) => {
    const len = Math.max(0.3, dur / 1000) + 0.15;
    let y1 = 0, y2 = 0;
    return render(len, (t: number) => {
      const p = Math.min(1, t / len);
      const cutoff = 250 + 2600 * Math.sin(Math.PI * p) ** 2;
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
      y1 += a * (noise() - y1);
      y2 += a * (y1 - y2);
      return 0.55 * y2 * Math.sin(Math.PI * Math.pow(p, 0.8)) ** 2;
    });
  },
  // The payoff: two soft sines a fifth apart, for the end card.
  resolve: () => render(2.2, (t: number) => {
    const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.7);
    return 0.12 * env * (Math.sin(2 * Math.PI * 659.25 * t) + 0.7 * Math.sin(2 * Math.PI * 987.77 * t) + 0.15 * Math.sin(2 * Math.PI * 1318.5 * t));
  }),
};

const GAIN: Record<string, number> = { click: 0.8, key: 0.55, pop: 0.7, whoosh: 0.45, resolve: 0.9 };

const SFX = fileURLToPath(new URL("../public/motion-assets/sfx/", import.meta.url));
/** A 16-bit mono WAV, scaled to a peak of 1 so the gains below are the only levels. */
function load(name: string): Float32Array | null {
  const p = `${SFX}${name}.wav`;
  if (!existsSync(p)) return null;
  const b = readFileSync(p);
  let o = 12;
  while (b.toString("ascii", o, o + 4) !== "data") o += 8 + b.readUInt32LE(o + 4);
  const f = new Float32Array(b.readUInt32LE(o + 4) / 2);
  let peak = 0;
  for (let i = 0; i < f.length; i++) peak = Math.max(peak, Math.abs((f[i] = b.readInt16LE(o + 8 + i * 2) / 32768)));
  for (let i = 0; i < f.length; i++) f[i] /= peak || 1;
  return f;
}
/** One of a set, played a few percent off pitch so repeats don't sound like a loop. */
function bank(names: string[]): ((rate?: number) => Float32Array) | null {
  const all = names.map(load).filter((s): s is Float32Array => !!s);
  if (!all.length) return null;
  return (rate?: number) => {
    const s = all[Math.floor(rnd() * all.length)], r = rate ?? 0.94 + rnd() * 0.12;
    return Float32Array.from({ length: Math.floor(s.length / r) }, (_, i) => s[Math.floor(i * r)]);
  };
}
const n = (name: string, count: number) => Array.from({ length: count }, (_, i) => `${name}${i + 1}`);
const samples: Record<string, ((rate?: number) => Float32Array) | null> = {
  click: bank(n("click", 3)), key: bank(n("key", 14)), force: bank(["force1"]),
  bubble: bank(n("bubble", 2)), message: bank(n("message", 2)), send: bank(n("send", 3)), react: bank(n("react", 2)),
  open: bank(n("open", 2)), create: bank(n("create", 2)), join: bank(n("join", 3)), voice: bank(["voice1"]),
  cam: bank(n("cam", 3)), share: bank(["share1"]), dress: bank(n("dress", 2)), appear: bank(["appear1"]),
  whoosh: bank(n("whoosh", 3)), fly: bank(n("fly", 2)), flap: bank(n("flap", 2)), sort: bank(["sort1"]), resolve: bank(["resolve1"]),
};
const SAMPLE_GAIN: Record<string, number> = {
  click: 0.42, key: 0.2, force: 0.14, bubble: 0.3, message: 0.32, send: 0.3, react: 0.3, open: 0.36, create: 0.38,
  join: 0.3, voice: 0.3, cam: 0.38, share: 0.32, dress: 0.4, appear: 0.32, whoosh: 0.34, fly: 0.5, flap: 0.3, sort: 0.2, resolve: 0.5,
};
// Without the sample folder, each kind falls back to the nearest synthesised voice.
const SYNTH: Record<string, string | null> = { force: null, bubble: "pop", message: "pop", send: "whoosh", react: "pop", open: "pop", create: "pop", join: "pop", voice: "pop", cam: "click", share: "pop", dress: "whoosh", appear: "resolve", fly: "whoosh", flap: null, sort: "pop" };
const MUSIC_GAIN = 0.16;

export type SfxEvent = { t: number; kind: string; dur?: number; rate?: number };

export function writeTrack(events: SfxEvent[], seconds: number, path: string) {
  const mix = new Float32Array(Math.ceil((seconds + 2.5) * RATE));
  const music = load("music");
  if (music) {
    const fade = 2.5 * RATE;
    for (let i = 0; i < mix.length; i++) mix[i] += MUSIC_GAIN * music[i % music.length] * Math.min(1, i / (0.4 * RATE), (mix.length - i) / fade);
  }
  for (const e of events) {
    const s = samples[e.kind]?.(e.rate);
    const synth = e.kind in SYNTH ? SYNTH[e.kind] : e.kind;
    const v = s ?? (synth && voices[synth]?.(e.dur));
    if (!v) continue;
    const g = s ? SAMPLE_GAIN[e.kind] : GAIN[synth as string];
    // Clicks a frame early read as on time; late ones read as lag.
    const start = Math.max(0, Math.round(((e.t - (e.kind === "click" ? 16 : 0)) / 1000) * RATE));
    for (let i = 0; i < v.length && start + i < mix.length; i++) mix[start + i] += v[i] * g;
  }
  let peak = 0;
  for (const s of mix) peak = Math.max(peak, Math.abs(s));
  const norm = peak > 0.7 ? 0.7 / peak : 1;
  const data = Buffer.alloc(44 + mix.length * 2);
  data.write("RIFF", 0); data.writeUInt32LE(36 + mix.length * 2, 4); data.write("WAVE", 8);
  data.write("fmt ", 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write("data", 36); data.writeUInt32LE(mix.length * 2, 40);
  for (let i = 0; i < mix.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[i] * norm)) * 32767), 44 + i * 2);
  writeFileSync(path, data);
}
