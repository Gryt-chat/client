// Get streams current volume
export function getCurrentVolume(analyser: AnalyserNode) {
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  analyser.getByteTimeDomainData(dataArray);

  let sum = 0;
  for (let i = 0; i < bufferLength; i++) {
    sum += (dataArray[i] - 128) * (dataArray[i] - 128);
  }

  const rms = Math.sqrt(sum / bufferLength);
  return rms;
}

// Return if user is speaking
export const isSpeaking = (analyser: AnalyserNode, threshold: number) => {
  const currentVolume = getCurrentVolume(analyser);
  return currentVolume > threshold;
};

/**
 * Loudness as dBFS, from the same RMS the speaking check uses.
 *
 * getCurrentVolume works on byte time-domain samples centred on 128, so full
 * scale is 128 and the result is 0 or below. Digital silence is -Infinity, and
 * callers are expected to clamp rather than to treat that as a number.
 */
export function getVolumeDb(analyser: AnalyserNode): number {
  const rms = getCurrentVolume(analyser);
  if (rms <= 0) return -Infinity;
  return 20 * Math.log10(rms / 128);
}

/** Quietest level the ring reacts to. Below this it sits at rest. */
export const VOLUME_FLOOR_DB = -55;

/** Where the ring reaches full size. Normal speech sits a little under this. */
export const VOLUME_CEIL_DB = -12;

/**
 * dBFS to a 0–1 ring size.
 *
 * Linear in dB rather than in amplitude, because amplitude spends almost all
 * of its range on sounds too quiet to see and then saturates — a ring driven
 * by it barely moves while someone talks normally.
 */
export function volumeToLevel(db: number): number {
  if (!Number.isFinite(db)) return 0;
  const t = (db - VOLUME_FLOOR_DB) / (VOLUME_CEIL_DB - VOLUME_FLOOR_DB);
  return Math.max(0, Math.min(1, t));
}
