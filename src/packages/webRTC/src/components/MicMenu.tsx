import { Popover, Select, Switch } from "@gryt/ui";
import { useMicrophone } from "@gryt/voice";
import { useEffect, useRef, useState } from "react";

import { useSettings } from "@/settings";

import { PiArrowRightBold } from "../../../../lib/icons";
import { type CallControlState, SplitArrow } from "./CallControlButton";

/** The popup the call bar's arrows open, as on the Mic board. */
export const CALL_MENU_STYLE = {
  width: 320,
  padding: 8,
  background: "var(--gryt-neutral-2)",
  border: "1px solid var(--gryt-neutral-6)",
  borderRadius: 16,
  boxShadow: "0 18px 48px rgba(0,0,0,.55)",
} as const;

/** The mic's arrow and its menu: microphone, a live level, noise suppression. */
export function MicMenu({ state, open, onOpenChange }: {
  state: CallControlState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { micID, setMicID, rnnoiseEnabled, setRnnoiseEnabled, isMuted, openSettings } = useSettings();
  const { devices, getDevices } = useMicrophone();
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // Read again on every open, so a headset plugged in mid-call is there, marked new.
  useEffect(() => {
    if (open) void getDevices();
  }, [open, getDevices]);
  useEffect(() => {
    if (!open) return;
    const ids = devices.map((d) => d.deviceId).filter(Boolean);
    if (ids.length === 0) return;
    const before = seen.current;
    setFresh(before ? new Set(ids.filter((id) => !before.has(id))) : new Set());
    seen.current = new Set(ids);
  }, [open, devices]);

  const options = devices.filter((d) => d.deviceId).map((d, i) => ({
    value: d.deviceId,
    label: (
      <span className="flex w-full items-center gap-2">
        <span className="truncate">{d.label || `Microphone ${i + 1}`}</span>
        {fresh.has(d.deviceId) && (
          <span className="ml-auto rounded-full bg-gryt-success-9 px-1.5 text-[10px] font-bold text-gryt-success-1">new</span>
        )}
      </span>
    ),
  }));

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger render={<SplitArrow state={state} open={open} aria-label="Microphone options" />} />
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={12}>
          <Popover.Popup
            aria-label="Microphone"
            // A mouse open leaves focus alone, so the dropdown doesn't open wearing its focus ring.
            initialFocus={(type) => type === "keyboard"}
            style={CALL_MENU_STYLE}
          >
            <div className="px-2.5 pt-2 pb-1 text-xs font-bold text-gryt-muted">Microphone</div>
            <div className="px-2.5 pt-0.5 pb-1.5">
              <Select
                aria-label="Microphone"
                value={micID || options[0]?.value || ""}
                onValueChange={(v) => setMicID(String(v))}
                options={options}
                size="small"
                className="w-full"
              />
            </div>
            <div className="px-2.5 pt-1.5 pb-1">
              <MicLevel muted={isMuted} />
              {isMuted && (
                <div className="mt-1.5 text-xs" style={{ color: "var(--gryt-danger-11)" }}>
                  You&rsquo;re muted, so nothing is sent. The bar still shows your mic works.
                </div>
              )}
            </div>
            <div className="mx-1 my-1.5 h-px bg-gryt-neutral-6" />
            <label className="flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm">
              <span className="flex-1">Noise suppression</span>
              <Switch checked={rnnoiseEnabled} onCheckedChange={setRnnoiseEnabled} />
            </label>
            <button
              type="button"
              className="flex w-full cursor-pointer items-center justify-between rounded-[10px] border-0 bg-transparent px-2.5 py-2 text-left text-sm text-gryt-muted hover:bg-gryt-neutral-4 hover:text-gryt-text"
              onClick={() => {
                onOpenChange(false);
                openSettings("audio");
              }}
            >
              Open audio settings
              <PiArrowRightBold size={12} />
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Reads the mic before the gate and the mute, so it moves whenever the mic hears you. Mounted only while open. */
function MicLevel({ muted }: { muted: boolean }) {
  const { microphoneBuffer } = useMicrophone();
  const analyser = microphoneBuffer.analyser ?? microphoneBuffer.monitorAnalyser;
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  return (
    <div
      role="meter"
      aria-label="Your microphone level"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(level * 100)}
      className="h-1.5 overflow-hidden rounded-full bg-gryt-neutral-6"
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${level * 100}%`, background: muted ? "var(--gryt-accent-7)" : "var(--gryt-success-9)" }}
      />
    </div>
  );
}
