/* A line a second about the call, for the bug report (GRYT-1663). "Large latency after a
   while" had settled by the time anybody looked, so this keeps the minutes before the report. */

export interface CallStatsSample {
  /** The voice server's socket answering a ping. */
  socketRttMs: number | null;
  /** The WebRTC round trip, from the nominated candidate pair. */
  rttMs: number | null;
  jitterMs: number | null;
  jitterBufferMs: number | null;
  /** Total so far; the line shows how many since the last one. */
  packetsLost: number | null;
  bitrateKbps: number | null;
  /** The whole voice path, both ways, as the latency panel estimates it. */
  estimatedRoundTripMs: number | null;
  /** Background windows throttle timers, which is the first suspect for "after a while". */
  visible: boolean;
  focused: boolean;
}

const MAX_LINES = 300;
let lines: string[] = [];
let started = 0;
let before: CallStatsSample | null = null;

const ms = (v: number | null) => (v === null ? "?" : `${Math.round(v)}ms`);

/** One line: what the call looked like this second, and what changed since the last. */
export function formatCallSample(secs: number, now: CallStatsSample, prev: CallStatsSample | null): string {
  const lost =
    now.packetsLost === null ? "?" : prev?.packetsLost == null ? String(now.packetsLost) : `+${now.packetsLost - prev.packetsLost}`;
  return [
    `+${secs}s`,
    `socket ${ms(now.socketRttMs)}`,
    `rtt ${ms(now.rttMs)} jitter ${ms(now.jitterMs)} buffer ${ms(now.jitterBufferMs)}`,
    `lost ${lost}`,
    `${now.bitrateKbps === null ? "?" : Math.round(now.bitrateKbps)}kbps`,
    `est ${ms(now.estimatedRoundTripMs)}`,
    `${now.visible ? "visible" : "hidden"}${now.focused ? " focused" : ""}`,
  ].join(" | ");
}

/** A new call starts a new timeline, so a report holds the call it was sent from or the last one. */
export function startCallTimeline(): void {
  started = Date.now();
  before = null;
  lines = [`call started ${new Date(started).toISOString()}`];
}

export function recordCallSample(sample: CallStatsSample): void {
  if (!started) return;
  lines.push(formatCallSample(Math.round((Date.now() - started) / 1000), sample, before));
  // The first line says when the call began; the rest is the newest few minutes.
  if (lines.length > MAX_LINES) lines = [lines[0], ...lines.slice(-(MAX_LINES - 1))];
  before = sample;
}

export function endCallTimeline(): void {
  if (!started) return;
  lines.push(`call ended after ${Math.round((Date.now() - started) / 1000)}s`);
  started = 0;
}

/** The current or last call's lines, oldest first. Empty before the first call. */
export function callTimeline(): string[] {
  return lines.slice();
}
