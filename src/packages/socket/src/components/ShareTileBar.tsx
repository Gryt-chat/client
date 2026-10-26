import { Slider, Tooltip } from "@gryt/ui";
import type { StreamSources } from "@gryt/voice";
import { useState } from "react";

import { gainToSlider, sliderToGain } from "@/lib/audioVolume";

import { PiCornersOutFill, PiSpeakerHighFill, PiX } from "../../../../lib/icons";

const CHIP = { background: "rgba(17,19,24,.85)", color: "#fff" };

/** On a share you watch: ✕ in the corner, and on hover its own volume, Stop watching and fullscreen. */
export function ShareTileBar({ name, audioStreamId, streamSources, onStop }: {
  name: string;
  audioStreamId?: string;
  streamSources?: StreamSources;
  onStop: () => void;
}) {
  const gain = audioStreamId ? streamSources?.[audioStreamId]?.gain : undefined;
  const [volume, setVolume] = useState(() => (gain ? gainToSlider(gain.gain.value, 200) : 100));
  return (
    <>
      <Tooltip title="Stop watching">
        <button
          type="button"
          aria-label={`Stop watching ${name}`}
          data-gryt="share-stop-watching"
          className="absolute right-2.5 top-2.5 flex h-[26px] w-[26px] cursor-pointer items-center justify-center rounded-full border-0"
          style={CHIP}
          onClick={(e) => {
            e.stopPropagation();
            onStop();
          }}
        >
          <PiX size={12} />
        </button>
      </Tooltip>
      <div
        className="absolute inset-x-2.5 bottom-11 flex h-[38px] items-center gap-2.5 rounded-full px-3 text-[13px] opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        style={CHIP}
        onClick={(e) => e.stopPropagation()}
      >
        {gain && (
          <>
            <PiSpeakerHighFill size={14} className="flex-none" aria-hidden />
            <div className="w-[90px] flex-none">
              <Slider
                aria-label={`Volume of ${name}`}
                value={volume}
                min={0}
                max={200}
                onValueChange={(next) => {
                  const v = Number(next);
                  setVolume(v);
                  gain.gain.setValueAtTime(sliderToGain(v, 200), 0);
                }}
              />
            </div>
          </>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className="cursor-pointer rounded-full border-0 px-2.5 py-1 text-xs font-bold"
          style={{ background: "var(--gryt-neutral-5)", color: "#fff" }}
          onClick={onStop}
        >
          Stop watching
        </button>
        <Tooltip title="Fullscreen">
          <button
            type="button"
            aria-label={`Show ${name} fullscreen`}
            className="flex cursor-pointer border-0 bg-transparent p-0 text-white"
            onClick={(e) => void e.currentTarget.closest<HTMLElement>("[data-share-tile]")?.requestFullscreen?.()}
          >
            <PiCornersOutFill size={16} />
          </button>
        </Tooltip>
      </div>
    </>
  );
}
