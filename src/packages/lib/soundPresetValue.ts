export interface SoundPreset {
  id: string;
  label: string;
  src: string;
}

const PREFIX = "preset:";

/** A preset is kept in the same setting as an uploaded file, as `preset:<id>`. */
export function presetValue(id: string): string {
  return `${PREFIX}${id}`;
}

export function presetIdOf(value: string | null): string | null {
  return value?.startsWith(PREFIX) ? value.slice(PREFIX.length) : null;
}

/** What to play: an uploaded file, a preset, or the list's default. */
export function resolveSound(value: string | null, presets: readonly SoundPreset[]): string {
  if (!value) return presets[0].src;
  const id = presetIdOf(value);
  if (id === null) return value;
  return (presets.find((p) => p.id === id) ?? presets[0]).src;
}
