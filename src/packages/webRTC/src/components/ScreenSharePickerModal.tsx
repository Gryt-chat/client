import { Button, Dialog, Select, Switch } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { type DesktopSource, isElectron } from "../../../../lib/electron";
import { PiMonitorFill, PiSpeakerHighFill, PiSpeakerSlashFill, PiSquaresFourFill } from "../../../../lib/icons";
import { currentPlatform, shareSoundHint } from "../../../../lib/screenShareAudio";
import { presetKey, SCREEN_PRESETS } from "../utils/streamQuality";

export interface SharePick {
  sourceId: string;
  quality: string;
  fps: number;
  withAudio: boolean;
}

interface ScreenSharePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The saved default, which a newly picked card starts on. */
  quality: string;
  fps: number;
  /** Switch picks one new source for a share that is already running. */
  mode?: "start" | "switch";
  onStart: (picks: SharePick[]) => void;
}

const PRESET_NAMES = ["Sharp text", "Smooth", "Less data"];

type Tab = "windows" | "screens";

export function ScreenSharePickerModal({ open, onOpenChange, quality, fps, mode = "start", onStart }: ScreenSharePickerModalProps) {
  const switching = mode === "switch";
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [tab, setTab] = useState<Tab>("windows");
  const [picks, setPicks] = useState<SharePick[]>([]);
  const [screenAccess, setScreenAccess] = useState<string | null>(null);
  const inElectron = isElectron();

  const loadSources = useCallback(async () => {
    const s = await window.electronAPI?.getDesktopSources();
    if (!s) return;
    setSources(s);
    setPicks((p) => p.filter((x) => s.some((src) => src.id === x.sourceId)));
  }, []);

  useEffect(() => {
    if (!open || !inElectron) {
      setPicks([]);
      setSources([]);
      setScreenAccess(null);
      return;
    }
    void loadSources();
    window.electronAPI?.getScreenCaptureAccess().then(setScreenAccess);
    const interval = setInterval(loadSources, 3000);
    return () => clearInterval(interval);
  }, [open, inElectron, loadSources]);

  if (!inElectron) return null;

  const shown = sources.filter((s) => s.sourceType === (tab === "screens" ? "screen" : "window"));
  const presets = SCREEN_PRESETS.map((p, i) => ({ value: presetKey(p.quality, p.fps), label: `${PRESET_NAMES[i]} · ${p.fps}` }));
  const savedKey = presetKey(quality, fps);
  if (!presets.some((p) => p.value === savedKey)) presets.push({ value: savedKey, label: `Your default · ${fps}` });

  const toggle = (sourceId: string) => setPicks((p) => {
    if (p.some((x) => x.sourceId === sourceId)) return p.filter((x) => x.sourceId !== sourceId);
    const pick = { sourceId, quality, fps, withAudio: true };
    return switching ? [pick] : [...p, pick];
  });
  const update = (sourceId: string, change: Partial<SharePick>) =>
    setPicks((p) => p.map((x) => (x.sourceId === sourceId ? { ...x, ...change } : x)));

  const n = picks.length;
  const noun = picks.every((p) => p.sourceId.startsWith("screen:")) ? "screen" : "window";
  let goLabel = switching ? "Switch" : "Share";
  if (!switching && n) goLabel = `Share ${n} ${noun}${n > 1 ? "s" : ""}`;
  const hint = shareSoundHint(currentPlatform(), picks.some((p) => p.sourceId.startsWith("screen:")));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[820px] max-w-[calc(100vw-32px)]" aria-label="Share your screen">
          <div className="flex h-11 items-center justify-between gap-3">
            <Dialog.Title className="text-lg font-extrabold">{switching ? "Share something else" : "Share your screen"}</Dialog.Title>
            <div className="flex rounded-full p-[3px] text-[13px] font-bold" style={{ background: "var(--gryt-neutral-3)" }} role="tablist">
              {(["windows", "screens"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  className="cursor-pointer rounded-full border-0 px-3.5 py-1.5"
                  style={tab === t ? { background: "var(--gryt-accent-9)", color: "var(--gryt-accent-contrast)" } : { background: "transparent", color: "inherit" }}
                  onClick={() => setTab(t)}
                >
                  {t === "windows" ? "Windows" : "Whole screen"}
                </button>
              ))}
            </div>
          </div>

          {screenAccess !== null && screenAccess !== "granted" && (
            <div className="mt-3 flex items-center gap-3 rounded-xl px-3 py-2" style={{ background: "var(--gryt-warning-3)", border: "1px solid var(--gryt-warning-6)" }}>
              <span className="flex-1 text-sm text-gryt-warning">
                macOS needs Screen Recording permission. Turn on Gryt in <strong>System Settings &rarr; Privacy &amp; Security &rarr; Screen Recording</strong>, then restart the app.
              </span>
              <Button tone="neutral" size="xsmall" onClick={() => window.electronAPI?.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")}>
                Open Settings
              </Button>
            </div>
          )}

          <div className="mt-3 grid max-h-[474px] grid-cols-3 gap-3 overflow-y-auto">
            {shown.length === 0 && (
              <span className="col-span-3 p-6 text-center text-sm text-gryt-muted">
                {sources.length ? `No ${tab === "screens" ? "screens" : "windows"} found` : "Looking for windows…"}
              </span>
            )}
            {shown.map((src) => {
              const i = picks.findIndex((p) => p.sourceId === src.id);
              const pick = picks[i];
              return (
                <div
                  key={src.id}
                  role="checkbox"
                  aria-checked={!!pick}
                  aria-label={src.name}
                  tabIndex={0}
                  className="relative h-[150px] cursor-pointer overflow-hidden rounded-[14px] border-2 border-solid"
                  style={pick
                    ? { borderColor: "var(--gryt-accent-9)", background: "var(--gryt-accent-3)" }
                    : { borderColor: "var(--gryt-neutral-6)", background: "var(--gryt-neutral-2)" }}
                  onClick={() => toggle(src.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== " " && e.key !== "Enter")) return;
                    e.preventDefault();
                    toggle(src.id);
                  }}
                >
                  <div className="relative flex h-[108px] items-center justify-center overflow-hidden bg-black">
                    {src.thumbnail && <img src={src.thumbnail} alt="" className="h-full w-full object-cover" draggable={false} />}
                    {!src.thumbnail && (src.sourceType === "screen" ? <PiMonitorFill size={24} /> : <PiSquaresFourFill size={24} />)}
                    {pick && (
                      <span
                        className="absolute left-2 top-2 flex h-[26px] w-[26px] items-center justify-center rounded-full text-sm font-extrabold"
                        style={{ background: "var(--gryt-accent-9)", color: "var(--gryt-accent-contrast)" }}
                      >
                        {i + 1}
                      </span>
                    )}
                    {pick && (
                      <div
                        role="group"
                        aria-label={`Quality and sound for ${src.name}`}
                        className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-2 rounded-[10px] p-1"
                        style={{ background: "rgba(17,19,24,.88)", color: "#e0e0e6" }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <Select
                          size="small"
                          className="min-w-0 flex-1"
                          value={presetKey(pick.quality, pick.fps)}
                          onValueChange={(v) => {
                            const [q, f] = String(v).split("@");
                            update(src.id, { quality: q, fps: Number(f) });
                          }}
                          options={presets}
                        />
                        {pick.withAudio
                          ? <PiSpeakerHighFill size={16} className="flex-none" color="var(--gryt-accent-11)" aria-label="Friends hear this window" />
                          : <PiSpeakerSlashFill size={16} className="flex-none" color="var(--gryt-muted)" aria-label="This window is muted for friends" />}
                        <Switch
                          aria-label={`Sound from ${src.name}`}
                          checked={pick.withAudio}
                          onCheckedChange={(on) => update(src.id, { withAudio: on })}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex h-[38px] items-center gap-2 px-3 text-sm font-bold">
                    {src.appIcon && <img src={src.appIcon} alt="" className="h-3.5 w-3.5 flex-none" draggable={false} />}
                    <span className="truncate">{src.name}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <span className="text-[13px] leading-snug text-gryt-muted">{hint}</span>
            <div className="flex flex-none gap-2">
              <Button tone="ghost" size="small" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                size="small"
                disabled={!n}
                onClick={() => {
                  onStart(picks);
                  onOpenChange(false);
                }}
              >
                {goLabel}
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
