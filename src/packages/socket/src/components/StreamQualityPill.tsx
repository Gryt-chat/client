import { Tooltip } from "@gryt/ui";
import { useSFU } from "@gryt/voice";
import { useEffect, useRef, useState } from "react";

import { type InboundDiagnostics, readVideoStats, type Stat } from "../../../../components/videoDebugStats";
import { qualityDetails, qualityPill } from "./streamQuality";

const NO_SENDERS = { camera: null, screen: null };

/** This stream's receiver, read once a second. Rates need the reading before, so it keeps one. */
function useInboundStats(stream: MediaStream | null | undefined): InboundDiagnostics | undefined {
  const sfu = useSFU();
  const sfuRef = useRef(sfu);
  sfuRef.current = sfu;
  const [stats, setStats] = useState<InboundDiagnostics>();
  const track = stream?.getVideoTracks()[0] ?? null;

  useEffect(() => {
    setStats(undefined);
    if (!track) return;
    let cancelled = false;
    let samples: ReadonlyMap<string, Stat> = new Map();
    const poll = async () => {
      const pc = sfuRef.current.getPeerConnection?.() ?? null;
      if (!pc) return;
      try {
        const report = await pc.getStats(track);
        if (cancelled) return;
        const reading = readVideoStats(report.values() as Iterable<Stat>, samples, NO_SENDERS);
        samples = reading.samples;
        setStats(reading.inbound[0]);
      } catch {
        // getStats can race the track or the connection closing.
      }
    };
    void poll();
    const interval = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [track]);

  return stats;
}

const MONO = "var(--font-mono)";
// Over video, so the dark theme's values in either theme: a light theme's tokens go dark-on-dark.
export const ON_VIDEO = { glass: "rgba(17,19,24,.8)", text: "#e0e0e6", fpsBg: "#2b2a47", fps: "#c3c1ff", sound: "#93e0a7" };

/** Top left on a share tile: what you're receiving, with the details on hover. */
export function StreamQualityPill({ stream }: { stream: MediaStream | null | undefined }) {
  const stats = useInboundStats(stream);
  const pill = qualityPill(stats);
  if (!stats || !pill) return null;

  return (
    <Tooltip
      side="bottom"
      title={
        <div className="grid gap-x-3 gap-y-0.5 text-xs" style={{ gridTemplateColumns: "auto auto" }}>
          {qualityDetails(stats).map(([label, value]) => (
            <div key={label} className="contents">
              <span style={{ color: "var(--gryt-neutral-11)" }}>{label}</span>
              <span style={{ fontFamily: MONO, fontVariantNumeric: "tabular-nums" }}>{value}</span>
            </div>
          ))}
        </div>
      }
    >
      <button
        type="button"
        aria-label={`${pill.resolution} at ${pill.fps}. Stream details`}
        onClick={(e) => e.stopPropagation()}
        className="absolute left-2.5 top-2.5 flex cursor-pointer items-center overflow-hidden rounded-full border-0 p-0 text-xs font-semibold"
        style={{ background: ON_VIDEO.glass, fontFamily: MONO, lineHeight: "18px" }}
      >
        <span style={{ padding: "2px 6px 2px 9px", color: ON_VIDEO.text }}>{pill.resolution}</span>
        <span style={{ padding: "2px 9px 2px 6px", background: ON_VIDEO.fpsBg, color: ON_VIDEO.fps }}>
          {pill.fps}
        </span>
      </button>
    </Tooltip>
  );
}
