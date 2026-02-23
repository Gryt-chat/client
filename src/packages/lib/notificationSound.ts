/**
 * Reliable notification sound player using the Web Audio API.
 *
 * HTML5 Audio (`new Audio().play()`) is throttled / blocked by browsers
 * in background tabs.  A shared AudioContext that was resumed during a
 * user gesture keeps working regardless of tab focus.
 */

import { sliderToGain } from "./audioVolume";

let ctx: AudioContext | null = null;
const bufferCache = new Map<string, AudioBuffer>();

function getContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

async function fetchBuffer(url: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(url);
  if (cached) return cached;

  const actx = getContext();
  const res = await fetch(url);
  const raw = await res.arrayBuffer();
  const buf = await actx.decodeAudioData(raw);
  bufferCache.set(url, buf);
  return buf;
}

/**
 * Play a notification sound.  Works in background / unfocused tabs.
 *
 * @param url         URL or data-URI of the sound file.
 * @param sliderValue Volume slider value (0-100).
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
 * Pre-decode a sound so that the first real playback is instant.
 * Call once per sound URL (e.g. on component mount).
 */
export function preloadNotificationSound(url: string): void {
  fetchBuffer(url).catch(() => {});
}

/**
 * Ensure the AudioContext is in the "running" state.
 * Call this from any user-gesture handler (click, keydown, etc.)
 * so that later programmatic playback is allowed by the browser.
 */
export function warmNotificationContext(): void {
  getContext();
}
