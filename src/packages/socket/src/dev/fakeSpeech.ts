/**
 * Speech for the fake voice participants, so a still of a voice channel shows
 * something happening.
 *
 * A screenshot of a call where nobody is talking is a grid of idle tiles — the
 * speaking ring and the halo, which are most of what the voice pass changed,
 * are invisible in it. This gives each fake participant a real audio track that
 * goes quiet and loud on a random schedule, so the indicator lights up the same
 * way it does for a real person.
 *
 * It is real audio rather than a boolean on purpose. The halo sizes itself from
 * an AnalyserNode frame by frame, so a fake that only flipped a flag would draw
 * a ring with a dead circle behind it, and would prove nothing about the part
 * that reads levels. Each fake gets noise through a gain node that is ramped
 * like speech, and the same analyser both drives the halo and answers "is this
 * person talking".
 *
 * Nothing is connected to the audio context's destination, so none of it is
 * audible.
 *
 * The speaking flags are polled here rather than in useServerState, whose loop
 * runs before the fakes are merged in and only knows about real clients. The
 * poll below is the remote branch of that loop — same isSpeaking, same
 * threshold, same 100ms — so what the tiles read is arrived at the same way.
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
 *
 * Silence is the longer of the two so a still lands on two or three people
 * mid-sentence rather than the whole grid lit up, which is neither what a call
 * looks like nor a useful picture of the indicator.
 */
const TURN_MIN_MS = 900;
const TURN_MAX_MS = 3200;
const PAUSE_MIN_MS = 1800;
const PAUSE_MAX_MS = 7000;

/** A syllable's worth of level, held before the next one is picked. */
const SYLLABLE_MIN_MS = 90;
const SYLLABLE_MAX_MS = 190;

/**
 * Loudness range of a syllable.
 *
 * The halo runs from -55 to -12 dBFS, and noise at gain g lands around
 * 20·log10(0.58·g) — so this covers roughly -25 dB up to -12 dB, which moves
 * the halo across most of its travel without pinning it at full size.
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
 * A couple of seconds of white noise, looped.
 *
 * Nobody hears it, so its spectrum does not matter — only that it has a steady
 * RMS for the envelope to shape.
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

  // A stream destination rather than a bare analyser: it makes the subgraph
  // something the context renders, and it means the participant is read
  // through a MediaStreamAudioSourceNode, which is what a real one is.
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
 * Voices for the fake participants that can talk.
 *
 * Muted and deafened ones are left out rather than given a silent voice — a
 * muted person has no audio arriving at all, and the tile should look like it.
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
