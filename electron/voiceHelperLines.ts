/** gryt-voice's command lines from the main process (GRYT-1837), apart so a check can import them. */

/** The commands the renderer may send after start: one line, a known word, nothing that could start another line. */
export function allowedVoiceCommand(line: unknown): line is string {
  return typeof line === "string" && line.length < 2048 && !/[\r\n]/.test(line) && /^(stop|sending|output|effects|gains)( |$)/.test(line);
}

export interface VoiceStart {
  addrs: string[];
  session: number;
  key: string;
  /** The nine effect values in the order voice_helper.c reads them. */
  effects: number[];
}

/** One start line from the offer, or null if any part could break the line protocol. */
export function startLine(s: VoiceStart, period = 64): string | null {
  const token = /^[^\s]{1,256}$/;
  if (!Number.isInteger(s.session) || s.session < 0 || !token.test(s.key) || s.addrs.length === 0 || !s.addrs.every((a) => token.test(a))) return null;
  if (s.effects.length !== 9 || !s.effects.every(Number.isFinite)) return null;
  return `effects ${s.effects.join(" ")}\nstart ${s.session} ${s.key} ${period} ${s.addrs.join(" ")}\n`;
}
