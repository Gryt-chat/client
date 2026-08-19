import { getVolumeDb, volumeToLevel } from "@gryt/voice";
import { useEffect, useRef } from "react";

/** How much bigger than the avatar the halo gets at full volume. */
const HALO_MAX_SCALE = 1.32;

/**
 * The disc behind the avatar that grows with how loudly someone is talking.
 *
 * Meet's speaking treatment is this plus a ring on the avatar, and nothing on
 * the tile — so that is what this does. The size follows dBFS rather than raw
 * amplitude; see volumeToLevel for why.
 *
 * Animated by writing to the element from requestAnimationFrame instead of
 * through state. The level changes every frame, and putting that in React
 * would re-render the whole panel sixty times a second to move one circle.
 *
 * Attack is faster than release, so a syllable is visible immediately and the
 * ring settles rather than flickering between words.
 */
export function SpeakingHalo({
  analyser,
  hue,
  size,
}: {
  analyser: AnalyserNode | undefined;
  hue: number;
  size: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!analyser || !el) return;

    let frame = 0;
    let smoothed = 0;

    const tick = () => {
      const level = volumeToLevel(getVolumeDb(analyser));
      smoothed += (level - smoothed) * (level > smoothed ? 0.45 : 0.1);

      el.style.transform = `scale(${1 + smoothed * (HALO_MAX_SCALE - 1)})`;
      el.style.opacity = String(0.18 + smoothed * 0.42);

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  if (!analyser) return null;

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: "50%",
        background: `hsl(${hue} 60% 62%)`,
        opacity: 0.18,
        transform: "scale(1)",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
