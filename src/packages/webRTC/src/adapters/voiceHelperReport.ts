import type { VoicePlatform } from "@gryt/voice";

/** gryt-voice's line protocol on the renderer side (GRYT-1837), apart so a check can import it. */
type Effects = Parameters<NonNullable<VoicePlatform["startNativeAudio"]>>[1];

/** What gryt-voice reports 20 times a second, kept so the session's sync getters can answer. */
export interface HelperReport {
  mic: number;
  micSpeaking: boolean;
  levels: Map<number, number>;
  buffered: Map<number, number>;
  speaking: number[];
  /** Measured round trips by sender (GRYT-1836); empty from a gryt-voice before them. */
  rtt: Map<number, number>;
}

export const EMPTY_REPORT: HelperReport = { mic: -120, micSpeaking: false, levels: new Map(), buffered: new Map(), speaking: [], rtt: new Map() };

/** voice_helper.c reads the effects as nine numbers in this order. */
export function effectValues(e: Effects): number[] {
  return [e.volume, e.gateThreshold, e.gateReleaseMs, e.gateSmoothing, e.autoGain ? 1 : 0, e.autoGainTargetDb, e.compressor ? 1 : 0, e.compressorAmount, e.limiter ? 1 : 0];
}

const pairs = (list: string): Map<number, number> =>
  new Map(list ? list.split(",").map((p) => p.split(":").map(Number) as [number, number]) : []);

/** `r <route> <mic dB> <mic speaking> l=<id>:<dB>,... b=<id>:<ms>,... s=<id>,... [t=<id>:<ms>,...]`, or null for anything else. */
export function parseReport(line: string): HelperReport | null {
  const m = /^r -?\d+ (-?[\d.]+) ([01]) l=(\S*) b=(\S*) s=(\S*)(?: t=(\S*))?$/.exec(line);
  if (!m) return null;
  return { mic: Number(m[1]), micSpeaking: m[2] === "1", levels: pairs(m[3]), buffered: pairs(m[4]), speaking: m[5] ? m[5].split(",").map(Number) : [], rtt: pairs(m[6] ?? "") };
}
