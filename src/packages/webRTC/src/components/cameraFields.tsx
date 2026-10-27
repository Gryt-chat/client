import { Select, Switch } from "@gryt/ui";
import { CAMERA_FPS_OPTIONS, QUALITY_CONSTRAINTS } from "@gryt/voice";
import { type ReactNode, useState } from "react";

import {
  CAMERA_PRESETS,
  CAMERA_QUALITY_ORDER,
  type CameraCapabilities,
  cameraCapabilities,
  CUSTOM_KEY,
  nativeDetail,
  nativeFps,
  presetDetail,
  presetKey,
} from "../utils/streamQuality";

/** A label on the left, its control on the right, as on the Camera board. */
export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 text-sm">
      <span className="font-semibold">{label}</span>
      {children}
    </div>
  );
}

export function SwitchRow({ label, checked, onCheckedChange }: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center justify-between gap-3 text-sm">
      <span className="font-semibold">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

/** Every Select on these rows is the same width, so a long device name cannot widen the row. */
const SELECT = { size: "small", className: "w-[190px]" } as const;

export function CameraSelect({ value, onChange, devices }: {
  value: string;
  onChange: (deviceId: string) => void;
  devices: { deviceId: string; label: string }[];
}) {
  const cameras = devices.filter((d) => d.deviceId);
  return (
    <Select
      {...SELECT}
      aria-label="Camera"
      value={value || cameras[0]?.deviceId || ""}
      onValueChange={(v) => onChange(String(v))}
      options={cameras.length === 0
        ? [{ label: "No cameras found", value: "", disabled: true }]
        : cameras.map((d, i) => ({ label: d.label || `Camera ${i + 1}`, value: d.deviceId }))}
    />
  );
}

/** A row's name, with what it comes out as in muted text beside it. */
function Row({ name, detail }: { name: string; detail: string | null }) {
  return (
    <span>
      {name}
      {detail && <span className="text-gryt-muted"> · {detail}</span>}
    </span>
  );
}

/** Native, the three presets, then Custom. Native is a `quality@fps` pair like the rest;
    Custom is not, so it carries a sentinel and opens two selects of its own. */
export function QualityFields({ quality, fps, onChange, track, deviceId }: {
  quality: string;
  fps: number;
  onChange: (quality: string, fps: number) => void;
  track: MediaStreamTrack | null;
  deviceId: string;
}) {
  const [custom, setCustom] = useState(false);
  const caps = cameraCapabilities(track, deviceId);
  const current = presetKey(quality, fps);
  const nativeKey = presetKey("native", nativeFps(caps));

  const rows = [
    { value: nativeKey, label: <Row name="Native" detail={nativeDetail(caps, current === nativeKey)} /> },
    // A camera that tops out at 30 makes Native and Sharp the same capture. Listing it once
    // under the name that explains it beats listing it twice under two.
    ...CAMERA_PRESETS
      .map((p) => ({ value: presetKey(p.quality, p.fps), label: <Row name={p.hint} detail={presetDetail(p.quality, p.fps)} /> }))
      .filter((r) => r.value !== nativeKey),
    { value: CUSTOM_KEY, label: <Row name="Custom" detail={null} /> },
  ];

  // A pair set in Settings that none of the rows covers is what Custom is for, so land on it
  // rather than listing the pair as a row of its own.
  const isCustom = custom || !rows.some((r) => r.value === current);

  return (
    <>
      <FieldRow label="Quality">
        <Select
          {...SELECT}
          aria-label="Quality"
          value={isCustom ? CUSTOM_KEY : current}
          onValueChange={(v) => {
            const picked = String(v);
            setCustom(picked === CUSTOM_KEY);
            if (picked === CUSTOM_KEY) return;
            const [q, f] = picked.split("@");
            onChange(q, Number(f));
          }}
          options={rows}
        />
      </FieldRow>
      {isCustom && (
        <>
          <FieldRow label="Resolution">
            <Select
              {...SELECT}
              aria-label="Resolution"
              value={quality}
              onValueChange={(v) => onChange(String(v), fps)}
              options={resolutionOptions(caps)}
            />
          </FieldRow>
          <FieldRow label="Frame rate">
            <Select
              {...SELECT}
              aria-label="Frame rate"
              value={String(fps)}
              onValueChange={(v) => onChange(quality, Number(v))}
              options={frameRateOptions(caps, fps)}
            />
          </FieldRow>
        </>
      )}
    </>
  );
}

/** Sizes the camera can reach, biggest first. Native keeps whatever it hands back. */
function resolutionOptions(caps: CameraCapabilities) {
  const maxHeight = caps.ceiling?.height ?? caps.live?.height;
  return CAMERA_QUALITY_ORDER
    .filter((q) => {
      if (q === "native") return true;
      const c = QUALITY_CONSTRAINTS[q];
      return !maxHeight || !c?.height || c.height <= maxHeight;
    })
    .map((q) => {
      const c = QUALITY_CONSTRAINTS[q];
      return {
        value: q,
        label: <Row name={q === "native" ? "Native" : q} detail={c?.width ? `${c.width}\u00d7${c.height}` : null} />,
      };
    });
}

/** Rates the camera can reach. A rate already set from Settings stays listed even if it cannot. */
function frameRateOptions(caps: CameraCapabilities, fps: number) {
  const maxFps = caps.ceiling?.fps ?? caps.live?.fps;
  const rates = CAMERA_FPS_OPTIONS.filter((f) => !maxFps || f <= maxFps + 0.5);
  const set = rates as number[];
  if (!set.includes(fps)) set.push(fps);
  set.sort((a, b) => a - b);
  return set.map((f) => ({ value: String(f), label: `${f} fps` }));
}
