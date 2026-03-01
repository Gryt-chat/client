/**
 * Structured voice chat flow logger.
 *
 * Prints numbered, colour-coded steps to the browser console so you can
 * instantly see where the voice-connect / disconnect pipeline stalls or fails.
 *
 * Usage:
 *   voiceLog.step(1, "Requesting microphone access");
 *   voiceLog.ok(1, "Microphone acquired", { deviceId, trackCount });
 *   voiceLog.fail(1, "Microphone denied", error);
 */

const COLORS = {
  step: "color:#6ea8fe;font-weight:bold",   // blue — starting a step
  ok: "color:#75b798;font-weight:bold",      // green — step succeeded
  fail: "color:#ea868f;font-weight:bold",    // red — step failed
  warn: "color:#ffda6a;font-weight:bold",    // yellow — non-fatal warning
  info: "color:#adb5bd",                     // grey — supplementary info
} as const;

type Phase = "CONNECT" | "DISCONNECT" | "MIC" | "PIPELINE" | "LOOPBACK" | "SFU-WS" | "SFU-SELECT" | "WEBRTC" | "SERVER" | "CAMERA" | "SCREEN";

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function fmt(phase: Phase, step: number | string, label: string): string {
  return `%c[${ts()}] [Voice:${phase}] Step ${step}: ${label}`;
}

function fmtPlain(phase: Phase, label: string): string {
  return `%c[${ts()}] [Voice:${phase}] ${label}`;
}

export const voiceLog = {
  step(phase: Phase, step: number | string, label: string, data?: unknown) {
    if (data !== undefined) {
      console.log(fmt(phase, step, label), COLORS.step, data);
    } else {
      console.log(fmt(phase, step, label), COLORS.step);
    }
  },

  ok(phase: Phase, step: number | string, label: string, data?: unknown) {
    if (data !== undefined) {
      console.log(fmt(phase, step, label), COLORS.ok, data);
    } else {
      console.log(fmt(phase, step, label), COLORS.ok);
    }
  },

  fail(phase: Phase, step: number | string, label: string, error?: unknown) {
    if (error !== undefined) {
      console.error(fmt(phase, step, label), COLORS.fail, error);
    } else {
      console.error(fmt(phase, step, label), COLORS.fail);
    }
  },

  warn(phase: Phase, label: string, data?: unknown) {
    if (data !== undefined) {
      console.warn(fmtPlain(phase, label), COLORS.warn, data);
    } else {
      console.warn(fmtPlain(phase, label), COLORS.warn);
    }
  },

  info(phase: Phase, label: string, data?: unknown) {
    if (data !== undefined) {
      console.log(fmtPlain(phase, label), COLORS.info, data);
    } else {
      console.log(fmtPlain(phase, label), COLORS.info);
    }
  },

  divider(title: string) {
    console.log(
      `%c${"═".repeat(20)} ${title} ${"═".repeat(20)}`,
      "color:#6ea8fe;font-weight:bold;font-size:13px",
    );
  },
};
