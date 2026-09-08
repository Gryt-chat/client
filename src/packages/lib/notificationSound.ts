/**
 * Notification sound player on the Web Audio API. HTML5 Audio is throttled in
 * background tabs; a resumed AudioContext keeps working regardless of focus.
 */

import { sliderToGain } from "./audioVolume";

interface AudioContextWithSink extends AudioContext {
  setSinkId?(sinkId: string): Promise<void>;
}

let ctx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();
const rawCache = new Map<string, ArrayBuffer>();

function getContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

async function fetchRaw(url: string): Promise<ArrayBuffer> {
  const cached = rawCache.get(url);
  if (cached) return cached;

  const res = await fetch(url);
  const raw = await res.arrayBuffer();
  rawCache.set(url, raw);
  return raw;
}

async function fetchBuffer(url: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(url);
  if (cached) return cached;

  const actx = getContext();
  const raw = await fetchRaw(url);
  rawCache.delete(url);
  const buf = await actx.decodeAudioData(raw);
  bufferCache.set(url, buf);
  return buf;
}

/**
 * Play a notification sound. Works in background tabs.
 * @param url URL or data-URI. @param sliderValue Volume slider value (0-100).
 */
export function playNotificationSound(url: string, sliderValue: number): void {
  const actx = getContext();

  fetchBuffer(url)
    .then((buf) => {
      const source = actx.createBufferSource();
      source.buffer = buf;

      const gain = actx.createGain();
      gain.gain.value = sliderToGain(sliderValue);

      source.connect(gain);
      gain.connect(actx.destination);
      source.start();
    })
    .catch((err) => {
      console.warn("[notificationSound] playback failed, falling back to Audio", err);
      try {
        const audio = new Audio(url);
        audio.volume = sliderToGain(sliderValue);
        audio.play().catch(() => {});
      } catch { /* give up silently */ }
    });
}

/**
 * Pre-fetch a sound's raw data so the first real playback is fast.
 * Does NOT create an AudioContext — decoding happens on first play.
 */
export function preloadNotificationSound(url: string): void {
  fetchRaw(url).catch(() => {});
}

/**
 * Ensure the AudioContext is running. Call from a user-gesture handler so later
 * programmatic playback is allowed. No-op if no sound has been played yet.
 */
export function warmNotificationContext(): void {
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  const saved = localStorage.getItem("outputDeviceID");
  if (saved) {
    const c = ctx as AudioContextWithSink;
    if (typeof c.setSinkId === "function") {
      c.setSinkId(saved).catch(() => {});
    }
  }
}

/**
 * Route notification sounds to a specific output device.
 * Uses AudioContext.setSinkId() when available (Chrome 110+, Electron).
 */
export function setNotificationOutputDevice(deviceId: string): void {
  const actx = getContext() as AudioContextWithSink;
  if (typeof actx.setSinkId === "function") {
    actx.setSinkId(deviceId).catch(() => {});
  }
}
