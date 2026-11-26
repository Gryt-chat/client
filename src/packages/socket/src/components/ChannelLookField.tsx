import { CARD_PATTERNS, PATTERN_GROUPS, Select } from "@gryt/ui";
import { useEffect, useRef, useState } from "react";

import type { Channel, ChannelPoster as Poster } from "@/settings/src/types/server";

import { usePosterVars } from "../hooks/usePosterVars";
import { ChannelPoster } from "./ChannelPoster";
import { ROLE_COLOR_PRESETS } from "./roleColorPresets";

// Line patterns only: a base pattern replaces the fill, and the scatter ones need an owl, icon or emoji a poster doesn't store.
const PATTERNS_BY_GROUP = PATTERN_GROUPS.map((group) => ({
  group,
  ids: CARD_PATTERNS.filter((p) => p.group === group && (p.kind === "svg" || p.kind === "tile")).map((p) => p.id),
})).filter((g) => g.ids.length > 0);
const LAYOUTS = [
  { label: "None", value: "none" },
  { label: "Classic", value: "classic" },
  { label: "Centred", value: "centred" },
  { label: "Quiet", value: "quiet" },
];
const DEFAULT_POSTER: Poster = { layout: "classic", fill: "solid", c1: ROLE_COLOR_PRESETS[0].value };

function Label({ children }: { children: string }) {
  return <span className="text-sm font-medium">{children}</span>;
}

function Swatches({ value, onPick, allowNone }: { value: string | null | undefined; onPick: (c: string | null) => void; allowNone?: boolean }) {
  const selected = value?.toLowerCase() ?? null;
  const ring = (on: boolean) => ({ outline: on ? "2px solid var(--gryt-text)" : "none", outlineOffset: 2 });
  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowNone && (
        <button type="button" aria-label="No colour" aria-pressed={!selected} onClick={() => onPick(null)}
          className="cursor-pointer rounded-full border border-dashed border-gryt-neutral-8 bg-transparent p-0" style={{ width: 22, height: 22, ...ring(!selected) }} />
      )}
      {ROLE_COLOR_PRESETS.map((p) => (
        <button key={p.value} type="button" aria-label={p.name} title={p.name} aria-pressed={p.value.toLowerCase() === selected} onClick={() => onPick(p.value.toLowerCase())}
          className="cursor-pointer rounded-full border-0 p-0" style={{ width: 22, height: 22, background: p.value, ...ring(p.value.toLowerCase() === selected) }} />
      ))}
      <input type="color" aria-label="Any other colour" title="Any other colour" value={value || "#888888"} onChange={(e) => onPick(e.target.value)}
        style={{ width: 22, height: 22, padding: 0, border: 0, background: "none", cursor: "pointer" }} />
    </div>
  );
}

function PatternSwatch({ pattern, c1, picked, onPick }: { pattern: string | undefined; c1: string; picked: boolean; onPick: () => void }) {
  const vars = usePosterVars({ layout: "classic", fill: "solid", c1, pattern }, pattern ?? "none");
  return (
    <button type="button" aria-label={pattern ?? "No pattern"} aria-pressed={picked} onClick={onPick}
      className="relative h-11 cursor-pointer overflow-hidden rounded-(--gryt-radius-md) p-0 text-xs"
      style={{ ...vars, background: "var(--poster-bg)", border: picked ? "2px solid var(--gryt-accent-9)" : "1px solid var(--gryt-neutral-6)", color: "var(--gryt-text)" }}>
      <span aria-hidden className="absolute inset-0" style={{ backgroundImage: "var(--pat-img, none)", backgroundSize: "cover" }} />
      {!pattern && <span className="relative">None</span>}
    </button>
  );
}

/** A channel's poster and colour, saved as they change like the rest of the dialog. */
export function ChannelLookField({ channel, serverName, onSave }: {
  channel: Channel;
  serverName?: string;
  onSave: (poster: Poster | null, color: string | null) => void;
}) {
  const [poster, setPoster] = useState<Poster | null>(channel.poster ?? null);
  const [color, setColor] = useState<string | null>(channel.color ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ poster, color, onSave });
  latest.current = { poster, color, onSave };

  useEffect(() => () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    latest.current.onSave(latest.current.poster, latest.current.color);
  }, []);

  const change = (nextPoster: Poster | null, nextColor: string | null) => {
    setPoster(nextPoster);
    setColor(nextColor);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; onSave(nextPoster, nextColor); }, 400);
  };
  const edit = (patch: Partial<Poster>) => change({ ...(poster ?? DEFAULT_POSTER), ...patch }, color);
  const c1 = poster?.c1 ?? DEFAULT_POSTER.c1 ?? "#5b4fd6";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>Poster</Label>
        <Select
          value={poster?.layout ?? "none"}
          onValueChange={(v) => (v === "none" ? change(null, color) : edit({ layout: v as Poster["layout"] }))}
          options={LAYOUTS}
        />
      </div>
      {poster && (
        <>
          <ChannelPoster poster={poster} channelName={channel.name} topic={channel.description} serverName={serverName} />
          {poster.layout !== "quiet" && (
            <div className="flex flex-col gap-2">
              <Label>Fill</Label>
              <Select
                value={poster.fill === "gradient" ? "gradient" : "solid"}
                onValueChange={(v) => edit(v === "gradient" ? { fill: "gradient", c2: poster.c2 ?? "#1a1d24" } : { fill: "solid", c2: undefined })}
                options={[{ label: "Solid", value: "solid" }, { label: "Gradient", value: "gradient" }]}
              />
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label>{poster.fill === "gradient" ? "First colour" : "Colour"}</Label>
            <Swatches value={c1} onPick={(c) => c && edit({ c1: c })} />
          </div>
          {poster.fill === "gradient" && poster.layout !== "quiet" && (
            <div className="flex flex-col gap-2">
              <Label>Second colour</Label>
              <Swatches value={poster.c2} onPick={(c) => c && edit({ c2: c })} />
            </div>
          )}
          {poster.layout !== "quiet" && (
            <div className="flex flex-col gap-2">
              <Label>Pattern</Label>
              <div className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  <PatternSwatch pattern={undefined} c1={c1} picked={!poster.pattern} onPick={() => edit({ pattern: undefined })} />
                </div>
                {PATTERNS_BY_GROUP.map(({ group, ids }) => (
                  <div key={group} className="flex flex-col gap-2">
                    <span className="text-xs" style={{ color: "var(--gryt-neutral-11)" }}>{group}</span>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {ids.map((p) => (
                        <PatternSwatch key={p} pattern={p} c1={c1} picked={poster.pattern === p} onPick={() => edit({ pattern: p })} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      <div className="flex flex-col gap-2">
        <Label>Channel colour</Label>
        <Swatches value={color} allowNone onPick={(c) => change(poster, c)} />
        <span className="text-xs text-gryt-muted">Colours this channel&rsquo;s icon in the list and its header. Everything else keeps each person&rsquo;s theme.</span>
      </div>
    </div>
  );
}
