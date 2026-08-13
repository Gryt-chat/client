import { Button, Checkbox, Chip, Dialog, IconButton, Select, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PiCaretDownFill, PiCaretUpFill, PiMonitorFill, PiScreencastFill, PiSquaresFourFill, PiX } from "react-icons/pi";

import type { ScreenShareFps, ScreenShareQuality } from "@/audio";
import { estimateBitrate, EXPERIMENTAL_FPS_OPTIONS, STANDARD_FPS_OPTIONS } from "@/audio";
import type { ScalabilityMode, ScreenShareCodec } from "@/settings";

import { type DesktopSource, isElectron } from "../../../../lib/electron";

interface ScreenSharePickerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quality: ScreenShareQuality;
  onQualityChange: (q: ScreenShareQuality) => void;
  fps: number;
  onFpsChange: (fps: number) => void;
  experimentalScreenShare: boolean;
  gamingMode: boolean;
  onGamingModeChange: (enabled: boolean) => void;
  codec: ScreenShareCodec;
  onCodecChange: (codec: ScreenShareCodec) => void;
  maxBitrate: number;
  onMaxBitrateChange: (bps: number) => void;
  scalabilityMode: ScalabilityMode;
  onScalabilityModeChange: (mode: ScalabilityMode) => void;
  nativeScreenCaptureAvailable?: boolean;
  onStart: (opts: { sourceId?: string; withAudio: boolean }) => void;
}

const ALL_QUALITY_OPTIONS: { value: ScreenShareQuality; label: string; height: number }[] = [
  { value: "4k", label: "4K (3840\u00d72160)", height: 2160 },
  { value: "1440p", label: "1440p (2560\u00d71440)", height: 1440 },
  { value: "1080p", label: "1080p (1920\u00d71080)", height: 1080 },
  { value: "720p", label: "720p (1280\u00d7720)", height: 720 },
  { value: "480p", label: "480p (854\u00d7480)", height: 480 },
  { value: "360p", label: "360p (640\u00d7360)", height: 360 },
  { value: "240p", label: "240p (426\u00d7240)", height: 240 },
  { value: "144p", label: "144p (256\u00d7144)", height: 144 },
  { value: "96p", label: "96p (170\u00d796)", height: 96 },
  { value: "64p", label: "64p (114\u00d764)", height: 64 },
  { value: "48p", label: "48p (85\u00d748)", height: 48 },
  { value: "32p", label: "32p (57\u00d732)", height: 32 },
  { value: "24p", label: "24p (43\u00d724)", height: 24 },
  { value: "16p", label: "16p (28\u00d716)", height: 16 },
  { value: "8p", label: "8p (14\u00d78)", height: 8 },
  { value: "4p", label: "4p (7\u00d74)", height: 4 },
];

const CODEC_OPTIONS: { value: ScreenShareCodec; label: string; mime: string }[] = [
  { value: "auto", label: "Auto (H.264)", mime: "" },
  { value: "h264", label: "H.264", mime: "video/H264" },
  { value: "vp9", label: "VP9", mime: "video/VP9" },
  { value: "av1", label: "AV1", mime: "video/AV1" },
];

const BITRATE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "Auto" },
  { value: 1_000_000, label: "1 Mbps" },
  { value: 2_000_000, label: "2 Mbps" },
  { value: 4_000_000, label: "4 Mbps" },
  { value: 6_000_000, label: "6 Mbps" },
  { value: 8_000_000, label: "8 Mbps" },
  { value: 10_000_000, label: "10 Mbps" },
  { value: 15_000_000, label: "15 Mbps" },
  { value: 20_000_000, label: "20 Mbps" },
  { value: 30_000_000, label: "30 Mbps" },
  { value: 50_000_000, label: "50 Mbps" },
];

const SVC_OPTIONS: { value: ScalabilityMode; label: string }[] = [
  { value: "L1T1", label: "Off (L1T1)" },
  { value: "L1T2", label: "2 layers (L1T2)" },
  { value: "L1T3", label: "3 layers (L1T3)" },
];

function getAvailableCodecs(): ScreenShareCodec[] {
  const caps = typeof RTCRtpSender !== "undefined"
    ? RTCRtpSender.getCapabilities?.("video")
    : null;
  if (!caps) return ["auto", "h264", "vp9"];
  const mimes = new Set(caps.codecs.map(c => c.mimeType.toLowerCase()));
  const available: ScreenShareCodec[] = ["auto"];
  for (const opt of CODEC_OPTIONS) {
    if (opt.value !== "auto" && mimes.has(opt.mime.toLowerCase())) {
      available.push(opt.value);
    }
  }
  return available;
}

function formatBitrate(bps: number): string {
  const mbps = bps / 1_000_000;
  return mbps >= 10 ? `${Math.round(mbps)} Mbps` : `${mbps.toFixed(1)} Mbps`;
}

function bitrateColor(bps: number): "green" | "yellow" | "red" {
  const mbps = bps / 1_000_000;
  if (mbps < 10) return "green";
  if (mbps <= 30) return "yellow";
  return "red";
}

type Tab = "screens" | "windows";

export function ScreenSharePickerModal({
  open, onOpenChange, quality, onQualityChange,
  fps, onFpsChange, experimentalScreenShare,
  gamingMode, onGamingModeChange,
  codec, onCodecChange,
  maxBitrate, onMaxBitrateChange,
  scalabilityMode, onScalabilityModeChange,
  nativeScreenCaptureAvailable = false,
  onStart,
}: ScreenSharePickerModalProps) {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("screens");
  const [selected, setSelected] = useState<string | null>(null);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [screenAccess, setScreenAccess] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const inElectron = isElectron();
  const [availableCodecs] = useState(getAvailableCodecs);

  const loadSources = useCallback(async () => {
    if (!inElectron) return;
    const api = window.electronAPI;
    if (!api) return;
    setLoading(true);
    try {
      const s = await api.getDesktopSources();
      setSources(s);
      if (s.length > 0 && !selected) {
        const screens = s.filter((x) => x.sourceType === "screen");
        setSelected(screens[0]?.id ?? s[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [inElectron, selected]);

  useEffect(() => {
    if (open && inElectron) {
      loadSources();
      window.electronAPI?.getScreenCaptureAccess().then(setScreenAccess);
    }
    if (!open) {
      setSelected(null);
      setSources([]);
      setScreenAccess(null);
    }
  }, [open, inElectron, loadSources]);

  useEffect(() => {
    if (!open || !inElectron) return;
    const interval = setInterval(loadSources, 3000);
    return () => clearInterval(interval);
  }, [open, inElectron, loadSources]);

  const filteredSources = sources.filter((s) =>
    tab === "screens" ? s.sourceType === "screen" : s.sourceType === "window",
  );

  const selectedSource = sources.find((s) => s.id === selected);
  const qualityOptions = useMemo(() => {
    const nativeOpt: { value: ScreenShareQuality; label: string }[] = [
      { value: "native", label: selectedSource?.height ? `Native (${selectedSource.width}\u00d7${selectedSource.height})` : "Native" },
    ];
    const sourceHeight = selectedSource?.height;
    const filtered = sourceHeight
      ? ALL_QUALITY_OPTIONS.filter((o) => o.height <= sourceHeight)
      : ALL_QUALITY_OPTIONS;
    return [...nativeOpt, ...filtered];
  }, [selectedSource]);

  useEffect(() => {
    const sourceHeight = selectedSource?.height;
    if (!sourceHeight) return;
    const currentOpt = ALL_QUALITY_OPTIONS.find((o) => o.value === quality);
    if (currentOpt && currentOpt.height > sourceHeight) {
      onQualityChange("native");
    }
  }, [selectedSource, quality, onQualityChange]);

  const fpsOptions = useMemo(() => {
    const options: { value: ScreenShareFps; label: string; disabled: boolean }[] = STANDARD_FPS_OPTIONS.map(
      (f) => {
        const needsNative = f > 60;
        const disabled = needsNative && !nativeScreenCaptureAvailable;
        let label = `${f} FPS`;
        if (needsNative && nativeScreenCaptureAvailable) label += " (Native)";
        else if (needsNative && !inElectron) label += " (Desktop app)";
        else if (needsNative) label += " (Unavailable)";
        return { value: f, label, disabled };
      },
    );
    if (experimentalScreenShare) {
      for (const f of EXPERIMENTAL_FPS_OPTIONS) {
        const needsNative = f > 60;
        const disabled = needsNative && !nativeScreenCaptureAvailable;
        let label = `${f} FPS`;
        if (needsNative && nativeScreenCaptureAvailable) label += " (Native)";
        else if (needsNative && !inElectron) label += " (Desktop app)";
        else if (needsNative) label += " (Unavailable)";
        options.push({ value: f, label, disabled });
      }
    }
    return options;
  }, [experimentalScreenShare, nativeScreenCaptureAvailable, inElectron]);

  const estimatedBps = useMemo(
    () => estimateBitrate(quality, fps),
    [quality, fps],
  );

  const svcDisabled = codec === "h264" || codec === "auto";

  const handleShare = () => {
    onStart({ sourceId: selected ?? undefined, withAudio: includeAudio });
    onOpenChange(false);
  };

  if (!inElectron) {
    if (open) {
      onStart({ withAudio: includeAudio });
      onOpenChange(false);
    }
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup style={{ maxWidth: 640 }}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PiScreencastFill size={16} />
              <Dialog.Title>Share your screen</Dialog.Title>
            </div>
            <Dialog.Close>
              <IconButton tone="ghost" size="xsmall" onClick={() => onOpenChange(false)}>
                <PiX size={16} />
              </IconButton>
            </Dialog.Close>
          </div>

          <div className="flex gap-2">
            <Button size="xsmall"
              onClick={() => setTab("screens")}
            >
              <PiMonitorFill size={14} />
              Screens
            </Button>
            <Button size="xsmall"
              onClick={() => setTab("windows")}
            >
              <PiSquaresFourFill size={14} />
              Windows
            </Button>
          </div>

          {screenAccess !== null && screenAccess !== "granted" && (
            <div className="flex items-center gap-3 px-3 py-2" style={{
                borderRadius: "var(--gryt-radius-sm)",
                background: "var(--gryt-warning-3)",
                border: "1px solid var(--gryt-warning-6)",
              }}>
              <span className="text-sm text-gryt-warning" style={{ flex: 1 }}>
                macOS requires Screen Recording permission. Grant access for Gryt in{" "}
                <strong>System Settings &rarr; Privacy &amp; Security &rarr; Screen Recording</strong>,
                then restart the app.
              </span>
              <Button tone="neutral" size="xsmall"
                style={{ flexShrink: 0 }}
                onClick={() => window.electronAPI?.openExternal(
                  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
                )}
              >
                Open Settings
              </Button>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 8,
              maxHeight: 320,
              overflow: "auto",
            }}
          >
            {loading && sources.length === 0 && (
              <span className="text-sm text-gryt-muted" style={{ gridColumn: "1 / -1", textAlign: "center", padding: 24 }}>
                Loading sources...
              </span>
            )}
            {!loading && filteredSources.length === 0 && (
              <span className="text-sm text-gryt-muted" style={{ gridColumn: "1 / -1", textAlign: "center", padding: 24 }}>
                No {tab === "screens" ? "screens" : "windows"} found
              </span>
            )}
            {filteredSources.map((src) => (
              <div className="flex flex-col gap-1" key={src.id} onClick={() => setSelected(src.id)} style={{
                  cursor: "pointer",
                  borderRadius: "var(--gryt-radius-md)",
                  border: selected === src.id ? "2px solid var(--gryt-accent-9)" : "2px solid transparent",
                  padding: 4,
                  background: selected === src.id ? "var(--gryt-accent-3)" : "var(--gryt-neutral-3)",
                  transition: "border-color 0.15s, background 0.15s",
                }}>
                <div style={{ position: "relative", aspectRatio: "16 / 9", borderRadius: "var(--gryt-radius-sm)", overflow: "hidden", background: "#000" }}>
                  {src.thumbnail ? (
                    <img
                      src={src.thumbnail}
                      alt={src.name}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      draggable={false}
                    />
                  ) : (
                    <div className="flex items-center justify-center" style={{ width: "100%", height: "100%" }}>
                      {src.sourceType === "screen" ? <PiMonitorFill size={24} /> : <PiSquaresFourFill size={24} />}
                    </div>
                  )}
                  {selected === src.id && (
                    <Chip tone="secondary"
                      style={{ position: "absolute", top: 4, right: 4 }}
                     label="Selected" />
                  )}
                </div>
                <div className="flex items-center gap-1 px-1">
                  {src.appIcon && src.sourceType === "window" && (
                    <img src={src.appIcon} alt="" style={{ width: 14, height: 14 }} draggable={false} />
                  )}
                  <span className="text-xs truncate" style={{ flex: 1 }}>
                    {src.name}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <Tooltip title="Capture desktop/application audio alongside the screen">
              <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <Checkbox checked={includeAudio} onCheckedChange={(v) => setIncludeAudio(v === true)} />
                Include audio
              </label>
            </Tooltip>

            <Tooltip title="Optimizes for fast-paced content like games. Allocates 50% more bitrate for smoother motion.">
              <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <Checkbox checked={gamingMode} onCheckedChange={(v) => onGamingModeChange(v === true)} />
                Gaming mode
              </label>
            </Tooltip>

            <div className="flex items-center gap-2 ml-auto">
              <Tooltip title="Capture resolution. Lower values use less bandwidth.">
                <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>Quality</span>
              </Tooltip>
              <Select
                value={quality}
                onValueChange={(v) => onQualityChange(v as ScreenShareQuality)}
                options={qualityOptions.map((o) => ({ label: o.label, value: o.value }))}
              />
            </div>

            <div className="flex items-center gap-2">
              <Tooltip title="Frames per second. Values above 60 use native DXGI screen capture (Windows desktop app only) to bypass browser FPS limits.">
                <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>FPS</span>
              </Tooltip>
              <Select
                value={String(fps)}
                onValueChange={(v) => onFpsChange(Number(v))}
                options={fpsOptions.map((o) => ({
                  label: o.label,
                  value: String(o.value),
                  disabled: o.disabled,
                }))}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Button tone="ghost" size="xsmall"
              onClick={() => setShowAdvanced(v => !v)}
              style={{ alignSelf: "flex-start", cursor: "pointer" }}
            >
              {showAdvanced ? <PiCaretUpFill size={14} /> : <PiCaretDownFill size={14} />}
              Advanced
            </Button>

            {showAdvanced && (
              <div className="flex flex-col gap-3 px-3 py-3" style={{
                  borderRadius: "var(--gryt-radius-sm)",
                  background: "var(--gryt-neutral-3)",
                }}>
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Tooltip title="H.264 has the widest hardware support. VP9/AV1 offer better compression but need newer GPUs (RTX 40+, Intel Arc, AMD RX 7000+).">
                      <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>Codec</span>
                    </Tooltip>
                    <Select
                      value={codec}
                      onValueChange={(v) => onCodecChange(v as ScreenShareCodec)}
                      options={CODEC_OPTIONS.filter((o) =>
                        availableCodecs.includes(o.value),
                      ).map((o) => ({ label: o.label, value: o.value }))}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Tooltip title="Fixed encoding bitrate. Auto estimates based on resolution and FPS. Higher values mean sharper video but require more upload bandwidth.">
                      <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>Bitrate</span>
                    </Tooltip>
                    <Select
                      value={String(maxBitrate)}
                      onValueChange={(v) => onMaxBitrateChange(Number(v))}
                      options={BITRATE_OPTIONS.map((o) => ({
                        label: o.label,
                        value: String(o.value),
                      }))}
                    />
                  </div>

                  <div className="flex items-center gap-2" style={svcDisabled ? { opacity: 0.5 } : undefined}>
                    <Tooltip title={svcDisabled
                      ? "SVC is not supported with H.264. Switch to VP9 or AV1 to enable temporal scalability layers."
                      : "Temporal scalability layers (VP9/AV1 only). Encodes multiple frame-rate tiers into a single stream."
                    }>
                      <span className="text-sm" style={{ cursor: "help", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 3 }}>SVC layers</span>
                    </Tooltip>
                    <Select
                      value={scalabilityMode}
                      onValueChange={(v) =>
                        onScalabilityModeChange(v as ScalabilityMode)
                      }
                      disabled={svcDisabled}
                      options={SVC_OPTIONS.map((o) => ({
                        label: o.label,
                        value: o.value,
                      }))}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {fps > 60 && nativeScreenCaptureAvailable && (
            <div className="flex items-center gap-2 px-3 py-1" style={{
                borderRadius: "var(--gryt-radius-sm)",
                background: "var(--gryt-success-3)",
              }}>
              <Chip tone="success" label="Native capture" />
              <span className="text-xs text-gryt-success">
                DXGI Desktop Duplication will be used for {fps} FPS capture
              </span>
            </div>
          )}

          {(maxBitrate > 0 || estimatedBps !== null) && (
            <div className="flex items-center gap-2 px-3 py-2" style={{
                borderRadius: "var(--gryt-radius-sm)",
                background: "var(--gryt-neutral-3)",
              }}>
              <span className="text-sm font-medium">
                {maxBitrate > 0 ? "Bitrate:" : "Estimated bitrate:"}
              </span>
              <Chip tone="neutral"
                color={bitrateColor(maxBitrate > 0 ? maxBitrate : estimatedBps!)}
              >
                {formatBitrate(maxBitrate > 0 ? maxBitrate : estimatedBps!)}
              </Chip>
              {(maxBitrate > 0 ? maxBitrate : estimatedBps!) / 1_000_000 > 30 && (
                <span className="text-xs text-gryt-danger">
                  Very high &mdash; ensure your connection can handle this
                </span>
              )}
            </div>
          )}
          {maxBitrate === 0 && estimatedBps === null && (
            <div className="flex items-center gap-2 px-3 py-2" style={{
                borderRadius: "var(--gryt-radius-sm)",
                background: "var(--gryt-neutral-3)",
              }}>
              <span className="text-sm text-gryt-muted">
                Bandwidth varies by source resolution (native mode)
              </span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button tone="neutral" size="small" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="small" onClick={handleShare} disabled={inElectron && !selected}>
              Share
            </Button>
          </div>
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
