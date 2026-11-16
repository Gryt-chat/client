import { useSFU } from "@gryt/voice";
import { useEffect, useState } from "react";

type Sides = [number, number];

const FLOOR_DB = -60;
const POLL_MS = 50;
const toPercent = (db: number) => Math.max(0, Math.min(100, ((db - FLOOR_DB) / -FLOOR_DB) * 100));

/** What plays in each ear during a call on Gryt's own voice connection, so a voice stuck on one side shows. */
export function OutputMeters() {
  const { getTransportLevels } = useSFU();
  const [sides, setSides] = useState<Sides | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSides(getTransportLevels?.()?.output ?? null);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [getTransportLevels]);

  if (!sides) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium">Output level</span>
      <span className="text-gryt-muted">
        What&rsquo;s playing in each ear right now. If someone only fills one side, that&rsquo;s where their voice
        is coming from.
      </span>
      {(["Left", "Right"] as const).map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span className="w-10 text-gryt-muted">{label}</span>
          <div style={{ flex: 1, height: 8, borderRadius: 4, background: "var(--gryt-neutral-a4)", overflow: "hidden" }}>
            <div
              style={{
                width: `${toPercent(sides[i])}%`,
                height: "100%",
                background: "var(--gryt-success-9)",
                transition: "width 60ms linear",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
