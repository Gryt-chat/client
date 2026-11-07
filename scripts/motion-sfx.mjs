// Synthesises the film's sound track from the events motion.html logged: four families plus one resolve.
// Made here rather than downloaded, so there is no licence to keep track of.
import { writeFileSync } from "node:fs";

const RATE = 48000;

let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const noise = () => rnd() * 2 - 1;

/** One-pole lowpass, coefficient from a cutoff in Hz. */
function lowpass(cutoff) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  return (x) => (y += a * (x - y));
}

function render(len, fn) {
  const out = new Float32Array(Math.ceil(len * RATE));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / RATE, i);
  return out;
}

const voices = {
  // A short dry tick: a high sine ping over a 3 ms click of filtered noise.
  click: () => {
    const f = 2300 * (0.95 + rnd() * 0.1);
    const lp = lowpass(6000);
    return render(0.05, (t) => 0.32 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.007) + 0.5 * lp(noise()) * Math.exp(-t / 0.0018));
  },
  // A soft keycap: darker and much quieter, pitch varied so a run of them isn't a machine gun.
  key: () => {
    const f = 900 + rnd() * 500;
    const lp = lowpass(3200);
    const g = 0.6 + rnd() * 0.4;
    return render(0.04, (t) => g * (0.09 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.004) + 0.22 * lp(noise()) * Math.exp(-t / 0.0025)));
  },
  // Something lands: a sine falling an octave, rounded off fast.
  pop: () => {
    const f0 = 560 * (0.92 + rnd() * 0.16);
    let ph = 0;
    return render(0.16, (t) => {
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
    return render(len, (t) => {
      const p = Math.min(1, t / len);
      const cutoff = 250 + 2600 * Math.sin(Math.PI * p) ** 2;
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
      y1 += a * (noise() - y1);
      y2 += a * (y1 - y2);
      return 0.55 * y2 * Math.sin(Math.PI * Math.pow(p, 0.8)) ** 2;
    });
  },
  // The payoff: two soft sines a fifth apart, for the end card.
  resolve: () => render(2.2, (t) => {
    const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.7);
    return 0.12 * env * (Math.sin(2 * Math.PI * 659.25 * t) + 0.7 * Math.sin(2 * Math.PI * 987.77 * t) + 0.15 * Math.sin(2 * Math.PI * 1318.5 * t));
  }),
};

const GAIN = { click: 0.8, key: 0.55, pop: 0.7, whoosh: 0.45, resolve: 0.9 };

export function writeTrack(events, seconds, path) {
  const mix = new Float32Array(Math.ceil((seconds + 2.5) * RATE));
  for (const e of events) {
    const v = voices[e.kind]?.(e.dur);
    if (!v) continue;
    // Clicks a frame early read as on time; late ones read as lag.
    const start = Math.max(0, Math.round(((e.t - (e.kind === "click" ? 16 : 0)) / 1000) * RATE));
    for (let i = 0; i < v.length && start + i < mix.length; i++) mix[start + i] += v[i] * GAIN[e.kind];
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
