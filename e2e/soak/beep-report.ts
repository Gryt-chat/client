// Pairs each beep heard with the one sent and prints the delay over the call, five minutes a row (voice#53).
// Usage: node e2e/soak/beep-report.ts e2e/soak/runs/<run> [--minutes 5]

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node e2e/soak/beep-report.ts <run directory> [--minutes 5]");
  process.exit(1);
}
const flag = process.argv.indexOf("--minutes");
const BUCKET_MS = (flag > 0 ? Number(process.argv[flag + 1]) : 5) * 60_000;

interface Stats {
  jitterBufferDelay?: number;
  jitterBufferTargetDelay?: number;
  jitterBufferEmittedCount?: number;
  concealedSamples?: number;
  insertedSamplesForDeceleration?: number;
  removedSamplesForAcceleration?: number;
}
interface Heard {
  who: string;
  heardAt: number;
  stats: Stats | null;
}

const sent: number[] = [];
const raw: number[] = [];
const tapped: number[] = [];
const heard: Heard[] = [];
let periodMs = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
  for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
    if (!line.includes('"beep.') && !line.includes("harness.config")) continue;
    const e = JSON.parse(line);
    if (e.type === "beep.sent") sent.push(e.sentAt);
    else if (e.type === "beep.raw") raw.push(e.rawAt);
    else if (e.type === "beep.tapped") tapped.push(e.tappedAt);
    else if (e.type === "beep.heard") heard.push({ who: e.who, heardAt: e.heardAt, stats: e.stats });
    else if (e.type === "harness.config" && e.beepMs) periodMs = e.beepMs;
  }
}
sent.sort((a, b) => a - b);
raw.sort((a, b) => a - b);
tapped.sort((a, b) => a - b);
if (!sent.length || !periodMs) {
  console.error("No beeps in this run. Was it started with GRYT_SOAK_BEEP_MS?");
  process.exit(1);
}

/** The latest beep sent before `at`, if it was within one period. */
function sentFor(at: number): number | null {
  let lo = 0;
  let hi = sent.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sent[mid] <= at) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best >= 0 && at - sent[best] < periodMs ? sent[best] : null;
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(0).padStart(5) : "    -");

const start = sent[0];
for (const who of [...new Set(heard.map((h) => h.who))].sort()) {
  const mine = heard.filter((h) => h.who === who).sort((a, b) => a.heardAt - b.heardAt);
  console.log(`\n${who}: ${mine.length} heard of ${sent.length} sent, every ${periodMs / 1000} s`);
  console.log("  minute   n  delay min   med   max   buffer  target  inserted  removed  concealed");
  const rows = new Map<number, { delays: number[]; buffer: number[]; target: number[]; first?: Stats; last?: Stats }>();
  let prev: Stats | null = null;
  for (const h of mine) {
    const s = sentFor(h.heardAt);
    const bucket = Math.floor((h.heardAt - start) / BUCKET_MS);
    const row = rows.get(bucket) ?? { delays: [], buffer: [], target: [] };
    rows.set(bucket, row);
    if (s !== null) row.delays.push(h.heardAt - s);
    const st = h.stats;
    if (st && prev && st.jitterBufferEmittedCount && prev.jitterBufferEmittedCount) {
      const dCount = st.jitterBufferEmittedCount - prev.jitterBufferEmittedCount;
      if (dCount > 0) {
        row.buffer.push((((st.jitterBufferDelay ?? 0) - (prev.jitterBufferDelay ?? 0)) / dCount) * 1000);
        row.target.push((((st.jitterBufferTargetDelay ?? 0) - (prev.jitterBufferTargetDelay ?? 0)) / dCount) * 1000);
      }
    }
    if (st) {
      row.first ??= st;
      row.last = st;
      prev = st;
    }
  }
  for (const [bucket, r] of [...rows].sort((a, b) => a[0] - b[0])) {
    const grew = (k: keyof Stats) => ((r.last?.[k] ?? 0) - (r.first?.[k] ?? 0)).toString().padStart(9);
    console.log(
      `  ${String((bucket * BUCKET_MS) / 60_000).padStart(6)} ${String(r.delays.length).padStart(3)}  ${fmt(Math.min(...r.delays))} ${fmt(median(r.delays))} ${fmt(Math.max(...r.delays))}   ${fmt(median(r.buffer))}   ${fmt(median(r.target))} ${grew("insertedSamplesForDeceleration")} ${grew("removedSamplesForAcceleration")} ${grew("concealedSamples")}`,
    );
  }
}

/** The first stamp in `list` at or after `from`, within one period. */
function firstAfter(list: number[], from: number): number | null {
  for (const t of list) if (t >= from) return t - from < periodMs ? t : null;
  return null;
}

// Where the delay goes, per beep, then the median of each step. The detector hop is in raw, tapped and heard alike.
if (raw.length && tapped.length) {
  const steps = { detector: [] as number[], send: [] as number[], wire: [] as number[], total: [] as number[] };
  const heardAt = heard.map((h) => h.heardAt).sort((a, b) => a - b);
  for (const s of sent) {
    const r = firstAfter(raw, s);
    const t = r === null ? null : firstAfter(tapped, r);
    const h = t === null ? null : firstAfter(heardAt, t);
    if (r === null || t === null || h === null) continue;
    steps.detector.push(r - s);
    steps.send.push(t - r);
    steps.wire.push(h - t);
    steps.total.push(h - s);
  }
  console.log(`\nStages over ${steps.total.length} beeps (median ms):`);
  console.log(`  beep to raw tap (oscillator + detector hop)   ${fmt(median(steps.detector))}`);
  console.log(`  raw to sent track (the app's send pipeline)   ${fmt(median(steps.send))}`);
  console.log(`  sent track to heard (encode, network, jitter buffer, decode)  ${fmt(median(steps.wire))}`);
  console.log(`  total                                         ${fmt(median(steps.total))}`);
}
