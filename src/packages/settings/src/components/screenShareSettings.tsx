import { Select, Switch } from "@gryt/ui";
import { EXPERIMENTAL_FPS_OPTIONS, STANDARD_FPS_OPTIONS, useScreenShare } from "@gryt/voice";
import { type ReactNode, useState } from "react";

import { type ScalabilityMode, type ScreenShareCodec, useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";
import { SettingsContainer, ToggleSetting } from "./settingsComponents";

const QUALITY_OPTIONS = [
  { value: "native", label: "Native (the window's own size)" },
  { value: "4k", label: "4K (3840×2160)" },
  { value: "1440p", label: "1440p (2560×1440)" },
  { value: "1080p", label: "1080p (1920×1080)" },
  { value: "720p", label: "720p (1280×720)" },
  { value: "480p", label: "480p (854×480)" },
  { value: "360p", label: "360p (640×360)" },
  { value: "240p", label: "240p (426×240)" },
  { value: "144p", label: "144p (256×144)" },
  { value: "96p", label: "96p (170×96)" },
  { value: "64p", label: "64p (114×64)" },
  { value: "48p", label: "48p (85×48)" },
  { value: "32p", label: "32p (57×32)" },
  { value: "24p", label: "24p (43×24)" },
  { value: "16p", label: "16p (28×16)" },
  { value: "8p", label: "8p (14×8)" },
  { value: "4p", label: "4p (7×4)" },
];

const CODEC_OPTIONS: { value: ScreenShareCodec; label: string; mime: string }[] = [
  { value: "auto", label: "Auto (H.264)", mime: "" },
  { value: "h264", label: "H.264", mime: "video/H264" },
  { value: "vp9", label: "VP9", mime: "video/VP9" },
  { value: "av1", label: "AV1", mime: "video/AV1" },
];

const BITRATE_OPTIONS = [0, 1, 2, 4, 6, 8, 10, 15, 20, 30, 50].map((mbps) => ({
  value: String(mbps * 1_000_000),
  label: mbps ? `${mbps} Mbps` : "Auto",
}));

const SVC_OPTIONS: { value: ScalabilityMode; label: string }[] = [
  { value: "L1T1", label: "Off (L1T1)" },
  { value: "L1T2", label: "2 layers (L1T2)" },
  { value: "L1T3", label: "3 layers (L1T3)" },
];

function availableCodecs(): ScreenShareCodec[] {
  const caps = typeof RTCRtpSender !== "undefined" ? RTCRtpSender.getCapabilities?.("video") : null;
  if (!caps) return ["auto", "h264", "vp9"];
  const mimes = new Set(caps.codecs.map((c) => c.mimeType.toLowerCase()));
  return CODEC_OPTIONS.filter((o) => o.value === "auto" || mimes.has(o.mime.toLowerCase())).map((o) => o.value);
}

function Field({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-medium">{title}</span>
      <span className="text-xs text-gryt-muted">{description}</span>
      {children}
    </div>
  );
}

/** What a share starts with. The picker sets quality per window on top of these. */
export function ScreenShareSettings() {
  const {
    experimentalScreenShare, setExperimentalScreenShare,
    screenShareQuality, setScreenShareQuality,
    screenShareFps, setScreenShareFps,
    screenShareGamingMode, setScreenShareGamingMode,
    screenShareCodec, setScreenShareCodec,
    screenShareMaxBitrate, setScreenShareMaxBitrate,
    screenShareScalabilityMode, setScreenShareScalabilityMode,
  } = useSettings();
  const { nativeScreenCaptureAvailable } = useScreenShare();
  const [codecs] = useState(availableCodecs);
  const svcOff = screenShareCodec === "h264" || screenShareCodec === "auto";

  const fpsOptions = [...STANDARD_FPS_OPTIONS, ...(experimentalScreenShare ? EXPERIMENTAL_FPS_OPTIONS : [])].map((f) => {
    const needsNative = f > 60;
    let note = "";
    if (needsNative && nativeScreenCaptureAvailable) note = " (Native)";
    else if (needsNative) note = isElectron() ? " (Unavailable)" : " (Desktop app)";
    return { value: String(f), label: `${f} FPS${note}`, disabled: needsNative && !nativeScreenCaptureAvailable };
  });

  return (
    <SettingsContainer>
      <h2 className="text-lg">
        Screen share
      </h2>

      <Field title="Quality" description="The size a new share starts at. Lower uses less bandwidth.">
        <Select value={screenShareQuality} onValueChange={(v) => setScreenShareQuality(String(v))} options={QUALITY_OPTIONS} />
      </Field>

      <Field title="Frame rate" description="Above 60 uses native capture, which only the Windows desktop app has.">
        <Select value={String(screenShareFps)} onValueChange={(v) => setScreenShareFps(Number(v))} options={fpsOptions} />
      </Field>

      <Field title="Gaming mode" description="Gives fast-moving content like games 50% more bitrate, so motion stays smooth.">
        <Switch checked={screenShareGamingMode} onCheckedChange={setScreenShareGamingMode} />
      </Field>

      <Field title="Codec" description="H.264 runs on almost any GPU. VP9 and AV1 compress better but need a newer one (RTX 40+, Intel Arc, AMD RX 7000+).">
        <Select
          value={screenShareCodec}
          onValueChange={(v) => setScreenShareCodec(v as ScreenShareCodec)}
          options={CODEC_OPTIONS.filter((o) => codecs.includes(o.value)).map((o) => ({ label: o.label, value: o.value }))}
        />
      </Field>

      <Field title="Bitrate" description="Auto works it out from quality and frame rate. Higher is sharper but needs more upload.">
        <Select value={String(screenShareMaxBitrate)} onValueChange={(v) => setScreenShareMaxBitrate(Number(v))} options={BITRATE_OPTIONS} />
      </Field>

      <Field title="SVC layers" description={svcOff ? "Only VP9 and AV1 have these. Pick one of them above to turn it on." : "Sends a few frame rates in one stream, so a slow connection can drop to a lower one."}>
        <Select
          value={screenShareScalabilityMode}
          onValueChange={(v) => setScreenShareScalabilityMode(v as ScalabilityMode)}
          disabled={svcOff}
          options={SVC_OPTIONS}
        />
      </Field>

      <ToggleSetting
        title="Experimental screen share"
        description="Unlock high frame rate options (144, 165, 240 FPS) for screen sharing. These require significant bandwidth and may not work on all hardware."
        checked={experimentalScreenShare}
        onCheckedChange={setExperimentalScreenShare}
        statusText={experimentalScreenShare
          ? "High FPS options (144, 165, 240) are available under Frame rate above"
          : undefined
        }
      />
    </SettingsContainer>
  );
}
