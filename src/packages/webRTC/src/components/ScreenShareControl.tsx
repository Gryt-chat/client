import { IconButton, Menu, Switch, Tooltip } from "@gryt/ui";
import { useScreenShare } from "@gryt/voice";
import { type CSSProperties, useCallback, useReducer, useState } from "react";
import toast from "react-hot-toast";

import { useSettings } from "@/settings";

import { isElectron } from "../../../../lib/electron";
import { PiMonitorArrowUpFill, PiPlus, PiSpeakerHighFill, PiSpeakerSlashFill, PiX } from "../../../../lib/icons";
import { firstShareKey, setFirstShareKey, setShareMeta, shareMeta, useShareWindowsVersion, windowKey } from "../adapters/shareWindows";
import { presetKey, SCREEN_PRESETS, screenPresetName } from "../utils/streamQuality";
import { useCallButtonPress } from "./callButtonPress";
import { CallControlButton, type CallControlButtonProps } from "./CallControlButton";
import { ScreenSharePickerModal,type SharePick } from "./ScreenSharePickerModal";

interface ScreenShareControlProps {
  iconSize?: number;
  size?: CallControlButtonProps["size"];
  buttonStyle?: CSSProperties;
  /** Added to the idle button only; live keeps its green. */
  idleClassName?: string;
  /** Whether the room lets you start one. A share already on keeps its button either way. */
  allowed?: boolean;
  /** Which way the menu opens: up from the call bar, right from the sidebar's column. */
  side?: "top" | "right";
  /** The call bar's button, which opens the picker when the rail's share is pressed. */
  takesRailPress?: boolean;
}

/** What the browser's own picker shared, when there's no window name to show. */
const SURFACE_NAMES: Record<string, string> = { monitor: "Screen", window: "Window", browser: "Tab" };

interface ShareRow {
  key: string;
  name: string;
  quality: string;
  fps: number;
  audio: MediaStreamTrack | undefined;
  setQuality: ((quality: string, fps: number) => void) | null;
  remove: (() => void) | null;
}

/** One shared window in the menu: its number, name, quality, sound and ✕. */
function ShareRowItem({ row, num }: { row: ShareRow; num: number }) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const sound = !!row.audio?.enabled;
  const current = presetKey(row.quality, row.fps);
  const presets = SCREEN_PRESETS.some((p) => presetKey(p.quality, p.fps) === current)
    ? SCREEN_PRESETS
    : [{ quality: row.quality, fps: row.fps, hint: "" }, ...SCREEN_PRESETS];
  return (
    <div className="flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-sm">
      <span
        className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-gryt-accent text-xs font-extrabold text-gryt-on-accent"
      >
        {num}
      </span>
      <span className="min-w-0 flex-1 truncate font-bold">{row.name}</span>
      {row.setQuality && (
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger
            aria-label={`Quality for ${row.name}`}
            className="flex-none gap-1 rounded-lg border border-solid px-2 py-0.5 text-xs"
            style={{ borderColor: "var(--gryt-neutral-6)", background: "var(--gryt-neutral-3)" }}
          >
            {screenPresetName(row.quality, row.fps).split(" · ")[0]}
          </Menu.SubmenuTrigger>
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup>
                <Menu.RadioGroup
                  value={current}
                  onValueChange={(v) => {
                    const [q, f] = String(v).split("@");
                    row.setQuality?.(q, Number(f));
                  }}
                >
                  {presets.map((p) => (
                    <Menu.RadioItem key={presetKey(p.quality, p.fps)} value={presetKey(p.quality, p.fps)}>
                      <span>{screenPresetName(p.quality, p.fps)}</span>
                      <span className="text-xs text-gryt-muted">{p.hint}</span>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.SubmenuRoot>
      )}
      {sound
        ? <PiSpeakerHighFill size={14} className="flex-none" color="var(--gryt-accent-11)" aria-hidden />
        : <PiSpeakerSlashFill size={14} className="flex-none" color="var(--gryt-muted)" aria-hidden />}
      <span title={row.audio ? undefined : "Shared without sound"} className="flex flex-none">
        <Switch
          aria-label={`Sound from ${row.name}`}
          checked={sound}
          disabled={!row.audio}
          onCheckedChange={(on) => {
            if (row.audio) row.audio.enabled = on;
            rerender();
          }}
        />
      </span>
      {row.remove ? (
        <IconButton tone="ghost" size="xsmall" aria-label={`Stop sharing ${row.name}`} className="text-gryt-danger" onClick={row.remove}>
          <PiX size={14} />
        </IconButton>
      ) : <span className="w-6 flex-none" />}
    </div>
  );
}

/** Off, it opens the picker. Live, it opens a menu, so a stray click can't end the share. */
export function ScreenShareControl({ iconSize = 16, size, buttonStyle, idleClassName, allowed = true, side = "top", takesRailPress = false }: ScreenShareControlProps) {
  const {
    screenShareActive, nativeEncodedCodec, screenVideoStream, screenAudioStream,
    startScreenShare, stopScreenShare, addScreenWindow, extraWindows, removeScreenWindow,
  } = useScreenShare();
  const {
    screenShareQuality, setScreenShareQuality,
    screenShareFps, setScreenShareFps,
  } = useSettings();
  const [picker, setPicker] = useState<"start" | "add" | null>(null);
  useShareWindowsVersion();
  const [isStarting, setIsStarting] = useState(false);

  const start = useCallback(
    async (picks: SharePick[], mode: "start" | "add") => {
      const toastId = "screen-share-starting";
      setIsStarting(true);
      toast.loading(mode === "add" ? "Adding…" : "Starting screen share…", { id: toastId });
      try {
        let rest = picks;
        if (mode === "start") {
          const [first] = picks;
          rest = picks.slice(1);
          setShareMeta(first.sourceId, { name: first.name });
          setFirstShareKey(first.sourceId);
          setScreenShareQuality(first.quality);
          setScreenShareFps(first.fps);
          await startScreenShare(first.withAudio, first.sourceId || undefined);
        }
        for (const p of rest) {
          setShareMeta(p.sourceId, { name: p.name, quality: p.quality, fps: p.fps });
          await addScreenWindow(p.withAudio, p.sourceId || undefined);
        }
      } finally {
        setIsStarting(false);
        toast.dismiss(toastId);
      }
    },
    [startScreenShare, addScreenWindow, setScreenShareQuality, setScreenShareFps],
  );

  // The browser brings its own picker, so the app's one is only for the desktop app.
  const openPicker = (mode: "start" | "add") => {
    if (isElectron()) setPicker(mode);
    else void start([{ sourceId: "", quality: screenShareQuality, fps: screenShareFps, withAudio: true }], mode);
  };

  useCallButtonPress("share", () => openPicker("start"), takesRailPress && !screenShareActive);

  const setFirstQuality = (quality: string, fps: number) => {
    setScreenShareQuality(quality);
    setScreenShareFps(fps);
  };

  // The engine can't drop its first window alone, so the next one takes its place.
  const next = extraWindows[0];
  const promoteNext = next?.sourceId
    ? () => {
      const key = windowKey(next);
      const m = shareMeta(key);
      if (m?.quality && m.fps) setFirstQuality(m.quality, m.fps);
      setFirstShareKey(key);
      const withAudio = !!next.audioStream?.getAudioTracks()[0]?.enabled;
      void startScreenShare(withAudio, next.sourceId).then(() => removeScreenWindow(next.index));
    }
    : null;

  const firstKey = firstShareKey();
  const nameOf = (key: string, video: MediaStreamTrack | undefined, num: number) =>
    shareMeta(key)?.name || `${SURFACE_NAMES[String(video?.getSettings().displaySurface)] ?? "Window"} ${num}`;
  const rows: ShareRow[] = [
    {
      key: firstKey,
      name: nameOf(firstKey, screenVideoStream?.getVideoTracks()[0], 1),
      quality: screenShareQuality,
      fps: screenShareFps,
      audio: screenAudioStream?.getAudioTracks()[0],
      // The native encoder picks its own size and rate, so a quality would do nothing there.
      setQuality: nativeEncodedCodec ? null : setFirstQuality,
      remove: next ? promoteNext : stopScreenShare,
    },
    ...extraWindows.map((w, i): ShareRow => {
      const key = windowKey(w);
      const m = shareMeta(key);
      return {
        key,
        name: nameOf(key, w.videoStream.getVideoTracks()[0], i + 2),
        quality: m?.quality ?? screenShareQuality,
        fps: m?.fps ?? screenShareFps,
        audio: w.audioStream?.getAudioTracks()[0],
        setQuality: (quality, fps) => setShareMeta(key, { quality, fps }),
        remove: () => removeScreenWindow(w.index),
      };
    }),
  ];

  if (!allowed && !screenShareActive && !isStarting) return null;

  return (
    <>
      {screenShareActive && (
        <Menu.Root>
          <Menu.Trigger
            render={
              <CallControlButton size={size} style={buttonStyle} state="live" aria-label="What you share" />
            }
          >
            <PiMonitorArrowUpFill size={iconSize} />
            {rows.length > 1 && (
              <span
                className="absolute -right-1 -top-1 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-gryt-success-9 text-[11px] font-extrabold text-gryt-success-1"
                aria-hidden
              >
                {rows.length}
              </span>
            )}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side={side}>
              <Menu.Popup aria-label="What you share" className="w-[400px] max-w-[calc(100vw-32px)]">
                <Menu.Group>
                  <Menu.GroupLabel>You&rsquo;re sharing</Menu.GroupLabel>
                  {rows.map((row, i) => <ShareRowItem key={row.key || i} row={row} num={i + 1} />)}
                </Menu.Group>
                <Menu.Item className="text-gryt-accent-11" onClick={() => openPicker("add")}>
                  <PiPlus size={14} />
                  Add a window
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item className="text-gryt-danger" onClick={stopScreenShare}>
                  Stop sharing
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
      {!screenShareActive && isStarting && (
        <Tooltip title="Starting screen share…">
          <CallControlButton size={size} style={buttonStyle} className={idleClassName} state="idle" aria-label="Starting screen share" disabled>
            <PiMonitorArrowUpFill size={iconSize} />
          </CallControlButton>
        </Tooltip>
      )}
      {!screenShareActive && !isStarting && (
        <CallControlButton size={size} style={buttonStyle} className={idleClassName} state="idle" aria-label="Share your screen" onClick={() => openPicker("start")}>
          <PiMonitorArrowUpFill size={iconSize} />
        </CallControlButton>
      )}

      <ScreenSharePickerModal
        open={picker !== null}
        onOpenChange={(open) => { if (!open) setPicker(null); }}
        mode={picker ?? "start"}
        quality={screenShareQuality}
        fps={screenShareFps}
        shared={picker === "add" ? rows.map((r) => r.key) : []}
        onStart={(picks) => void start(picks, picker ?? "start")}
      />
    </>
  );
}
