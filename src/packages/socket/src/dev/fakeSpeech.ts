/**
 * Speech for the fake voice participants: real audio, because the halo sizes
 * itself from an AnalyserNode. Nothing is connected to the destination.
 */
import type { StreamSources } from "@gryt/voice";
import { isSpeaking, useSharedAudioContext } from "@gryt/voice";
import { useEffect, useState } from "react";

import {
  fakeAudioStreamId,
  fakeParticipantId,
  type FakeParticipantOptions,
} from "./fakeParticipants";

/** Same rate and threshold as the remote path in useServerState. */
const POLL_MS = 100;
const SPEAKING_THRESHOLD = 0.1;

/**
 * How long a turn lasts, and how long someone waits before taking another.
 * Silence is the longer, so a still lands on two or three people mid-sentence.
 */
const TURN_MIN_MS = 900;
const TURN_MAX_MS = 3200;
const PAUSE_MIN_MS = 1800;
const PAUSE_MAX_MS = 7000;

/** A syllable's worth of level, held before the next one is picked. */
const SYLLABLE_MIN_MS = 90;
const SYLLABLE_MAX_MS = 190;

/**
 * Loudness range of a syllable. The halo runs -55 to -12 dBFS and noise at gain g
 * lands near 20·log10(0.58·g), so this covers about -25 to -12 dB.
 */
const LEVEL_MIN = 0.1;
const LEVEL_MAX = 0.45;

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

interface Voice {
  clientId: string;
  streamId: string;
  /** Ramped like speech; everything downstream follows from it. */
  envelope: GainNode;
  entry: StreamSources[string];
  noise: AudioBufferSourceNode;
  /** performance.now() at which this voice starts or stops talking. */
  turnEndsAt: number;
  nextSyllableAt: number;
  talking: boolean;
}

/**
 * A couple of seconds of white noise, looped. Nobody hears it, so the spectrum
 * does not matter — only a steady RMS for the envelope to shape.
 */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function createVoice(ctx: AudioContext, clientId: string): Voice {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  noise.loop = true;

  const envelope = ctx.createGain();
  envelope.gain.value = 0;

  // A stream destination rather than a bare analyser: the context renders the
  // subgraph, and the participant is read through a MediaStreamAudioSourceNode.
  const sink = ctx.createMediaStreamDestination();
  noise.connect(envelope).connect(sink);
  noise.start();

  const source = ctx.createMediaStreamSource(sink.stream);
  const analyser = ctx.createAnalyser();
  source.connect(analyser);

  return {
    clientId,
    streamId: fakeAudioStreamId(clientId),
    envelope,
    noise,
    // The gain is here because a stream source has one. Nothing plays it, so
    // nothing reads it either.
    entry: { gain: ctx.createGain(), analyser, stream: source },
    turnEndsAt: performance.now() + between(0, PAUSE_MAX_MS),
    nextSyllableAt: 0,
    talking: false,
  };
}

function destroyVoice(voice: Voice) {
  try {
    voice.noise.stop();
  } catch {
    // Already stopped, which happens if the context went away first.
  }
  voice.noise.disconnect();
  voice.envelope.disconnect();
  voice.entry.stream.disconnect();
}

export interface FakeSpeech {
  /** Keyed by streamID, ready to merge into the real stream sources. */
  sources: StreamSources;
  /** Keyed by client id, ready to merge into clientsSpeaking. */
  speaking: Record<string, boolean>;
}

const NOTHING: FakeSpeech = { sources: {}, speaking: {} };

/**
 * Voices for the fake participants that can talk. Muted and deafened ones are
 * left out: a muted person has no audio arriving, and the tile should show it.
 */
export function useFakeSpeech(options: FakeParticipantOptions | null): FakeSpeech {
  const { audioContext } = useSharedAudioContext();
  const [speech, setSpeech] = useState<FakeSpeech>(NOTHING);

  const count = options?.speak ? options.count : 0;
  const muted = options?.muted ?? 0;
  const deafened = options?.deafened ?? false;

  useEffect(() => {
    if (!import.meta.env.DEV || !count || !audioContext) {
      setSpeech(NOTHING);
      return;
    }

    const voices: Voice[] = [];
    const sources: StreamSources = {};

    for (let i = 0; i < count; i++) {
      if (i < muted) continue;
      if (deafened && i === count - 1) continue;

      const voice = createVoice(audioContext, fakeParticipantId(i));
      voices.push(voice);
      sources[voice.streamId] = voice.entry;
    }

    setSpeech({ sources, speaking: {} });

    const interval = setInterval(() => {
      const now = performance.now();
      const time = audioContext.currentTime;

      for (const voice of voices) {
        if (now >= voice.turnEndsAt) {
          voice.talking = !voice.talking;
          voice.turnEndsAt = voice.talking
            ? now + between(TURN_MIN_MS, TURN_MAX_MS)
            : now + between(PAUSE_MIN_MS, PAUSE_MAX_MS);
          // Faster on the way down than up, so a turn ends promptly instead of
          // the ring hanging around after the tail.
          if (!voice.talking) voice.envelope.gain.setTargetAtTime(0, time, 0.04);
        }

        if (voice.talking && now >= voice.nextSyllableAt) {
          voice.envelope.gain.setTargetAtTime(between(LEVEL_MIN, LEVEL_MAX), time, 0.03);
          voice.nextSyllableAt = now + between(SYLLABLE_MIN_MS, SYLLABLE_MAX_MS);
        }
      }

      setSpeech((prev) => {
        const next: Record<string, boolean> = {};
        let changed = false;

        for (const voice of voices) {
          const talking = isSpeaking(voice.entry.analyser, SPEAKING_THRESHOLD);
          next[voice.clientId] = talking;
          if (prev.speaking[voice.clientId] !== talking) changed = true;
        }

        return changed ? { sources: prev.sources, speaking: next } : prev;
      });
    }, POLL_MS);

    return () => {
      clearInterval(interval);
      voices.forEach(destroyVoice);
      setSpeech(NOTHING);
    };
  }, [audioContext, count, muted, deafened]);

  return speech;
}
