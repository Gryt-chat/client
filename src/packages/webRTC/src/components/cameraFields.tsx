import { Select, Switch } from "@gryt/ui";
import type { ReactNode } from "react";

import { CAMERA_PRESETS, presetDetail, presetKey, presetLabel } from "../utils/streamQuality";

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

export function CameraSelect({ value, onChange, devices }: {
  value: string;
  onChange: (deviceId: string) => void;
  devices: { deviceId: string; label: string }[];
}) {
  const cameras = devices.filter((d) => d.deviceId);
  return (
    <Select
      aria-label="Camera"
      size="small"
      className="w-[190px]"
      value={value || cameras[0]?.deviceId || ""}
      onValueChange={(v) => onChange(String(v))}
      options={cameras.length === 0
        ? [{ label: "No cameras found", value: "", disabled: true }]
        : cameras.map((d, i) => ({ label: d.label || `Camera ${i + 1}`, value: d.deviceId }))}
    />
  );
}

/** Sharp, Normal or Saves data. A setting from Settings that isn't one of them stays listed as itself. */
export function QualitySelect({ quality, fps, onChange }: {
  quality: string;
  fps: number;
  onChange: (quality: string, fps: number) => void;
}) {
  const current = presetKey(quality, fps);
  const options = CAMERA_PRESETS.map((p) => ({
    value: presetKey(p.quality, p.fps),
    label: (
      <span>
        {p.hint} <span className="text-gryt-muted">· {presetDetail(p.quality, p.fps)}</span>
      </span>
    ),
  }));
  if (!options.some((o) => o.value === current)) options.unshift({ value: current, label: <span>{presetLabel(quality, fps)}</span> });
  return (
    <Select
      aria-label="Quality"
      size="small"
      className="w-[190px]"
      value={current}
      onValueChange={(v) => {
        const [q, f] = String(v).split("@");
        onChange(q, Number(f));
      }}
      options={options}
    />
  );
}
