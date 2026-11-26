import { Menu, Spinner } from "@gryt/ui";
import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { PiDotsThreeBold, PiPauseFill, PiPlayFill, PiSpeakerHighFill, PiSpeakerSlashFill, PiWarningCircle } from "../../../../lib/icons";
import { triggerDownload } from "../utils/downloadFile";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "–:––";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The video player's parts in a capsule. Volume is shared with videos, 0 to 100. */
export function ChatAudioPlayer({ src, label, fileName, volume, onVolumeChange, onError }: {
  src: string;
  label: string | null;
  fileName?: string | null;
  volume: number;
  onVolumeChange: (v: number) => void;
  /** The load failed. The owner may hand back a new `src`. */
  onError?: () => void;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const resumeAt = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);

  useEffect(() => setFailed(false), [src]);

  useEffect(() => {
    const el = audio.current;
    if (el) el.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed]);

  const togglePlay = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  }, []);

  const seekBy = (by: number) => {
    const el = audio.current;
    if (el && Number.isFinite(el.duration)) el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + by));
  };

  const toggleMute = () => {
    const el = audio.current;
    if (el) el.muted = !el.muted;
  };

  // Sliders and the menu handle their own keys.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("input, [role=menu], [role=menuitem]")) return;
    if (e.key === " " || e.key === "k") togglePlay();
    else if (e.key === "ArrowLeft") seekBy(-5);
    else if (e.key === "ArrowRight") seekBy(5);
    else if (e.key === "m") toggleMute();
    else return;
    e.preventDefault();
  };

  const level = muted ? 0 : volume;
  const played = Number.isFinite(duration) && duration > 0 ? (time / duration) * 100 : 0;

  return (
    <div className="chat-audio-player">
      {label && <span className="chat-media-filename">{label}</span>}
      <div className="chat-audio" role="group" aria-label={fileName ? `Audio: ${fileName}` : "Audio"} onKeyDown={onKeyDown}>
        <audio
          ref={audio}
          preload="metadata"
          src={src}
          loop={loop}
          onPlay={(e) => {
            setPlaying(true);
            const self = e.currentTarget;
            document.querySelectorAll("audio").forEach((other) => other !== self && other.pause());
          }}
          onPause={() => setPlaying(false)}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onProgress={(e) => {
            const el = e.currentTarget;
            if (el.buffered.length && el.duration) setBuffered((el.buffered.end(el.buffered.length - 1) / el.duration) * 100);
          }}
          onVolumeChange={(e) => {
            setMuted(e.currentTarget.muted);
            const pct = Math.round(e.currentTarget.volume * 100);
            if (pct !== volume) onVolumeChange(pct);
          }}
          onError={(e) => {
            if (e.currentTarget.currentTime > 0) resumeAt.current = e.currentTarget.currentTime;
            setFailed(true);
            setWaiting(false);
            onError?.();
          }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            el.playbackRate = speed;
            if (resumeAt.current == null) return;
            el.currentTime = resumeAt.current;
            resumeAt.current = null;
            void el.play().catch(() => {});
          }}
        />
        {failed ? (
          <>
            <PiWarningCircle size={18} aria-hidden className="chat-audio-warn" />
            <span className="chat-audio-failed" role="alert">This file couldn&rsquo;t be played.</span>
            <button type="button" className="chat-audio-retry" onClick={() => { setFailed(false); onError?.(); audio.current?.load(); }}>
              Try again
            </button>
          </>
        ) : (
          <>
            <button type="button" className="chat-audio-play" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
              {waiting && playing && <Spinner size={20} aria-label="Loading audio" />}
              {!waiting && playing && <PiPauseFill size={16} />}
              {!playing && <PiPlayFill size={16} />}
            </button>
            <span className="chat-audio-time">{clock(time)}</span>
            <input
              type="range"
              className="chat-audio-seek"
              aria-label="Seek"
              aria-valuetext={`${clock(time)} of ${clock(duration)}`}
              min={0}
              max={Number.isFinite(duration) ? duration : 0}
              step={0.1}
              value={time}
              disabled={!Number.isFinite(duration)}
              onChange={(e) => {
                const el = audio.current;
                if (el) el.currentTime = Number(e.target.value);
                setTime(Number(e.target.value));
              }}
              style={{ "--played": `${played}%`, "--buffered": `${buffered}%` } as CSSProperties}
            />
            <span className="chat-audio-time">{clock(duration)}</span>
            <span className="chat-audio-volume">
              <button type="button" className="chat-audio-icon" aria-label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
                {level === 0 ? <PiSpeakerSlashFill size={18} /> : <PiSpeakerHighFill size={18} />}
              </button>
              <input
                type="range"
                className="chat-audio-level"
                aria-label="Volume"
                min={0}
                max={100}
                value={level}
                onChange={(e) => {
                  const el = audio.current;
                  if (!el) return;
                  el.muted = false;
                  el.volume = Number(e.target.value) / 100;
                }}
                style={{ "--played": `${level}%` } as CSSProperties}
              />
            </span>
          </>
        )}
        <Menu.Root>
          <Menu.Trigger render={<button type="button" className="chat-audio-icon" aria-label="More" />}>
            <PiDotsThreeBold size={18} />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup aria-label="Audio options">
                <Menu.Item onClick={() => void triggerDownload(src, fileName)}>Download</Menu.Item>
                <Menu.Separator />
                <Menu.RadioGroup value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
                  {SPEEDS.map((s) => (
                    <Menu.RadioItem key={s} value={String(s)}>{s === 1 ? "Normal speed" : `${s}×`}</Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
                <Menu.Separator />
                <Menu.CheckboxItem checked={loop} onCheckedChange={setLoop}>Loop</Menu.CheckboxItem>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
  );
}
