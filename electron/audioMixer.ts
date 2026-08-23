/**
 * Sums the PCM coming out of several capture processes into one stream.
 *
 * Capturing more than one application means one child process per application
 * — WASAPI process loopback activates against a single PID — and the renderer
 * still wants a single track. Mixing here rather than in the renderer keeps
 * @gryt/voice out of it: its `useNativeAudioCapture` reads one `native-audio-data`
 * channel and does not need to know how many sources are behind it.
 *
 * Every source produces the same format, which is what the capture binaries
 * are written to emit: 48 kHz, 16-bit signed, stereo, little endian. Nothing
 * here resamples.
 */

/** 48 kHz stereo 16-bit: 4 bytes a frame, 1920 bytes for 10 ms. */
export const BYTES_PER_FRAME = 4;
export const MIX_CHUNK_BYTES = 1920;

/**
 * How far a source is allowed to run ahead before the oldest audio is dropped.
 *
 * Each capture process has its own clock and they drift, so a source that runs
 * fast would otherwise grow its queue forever and be heard later and later
 * behind the others. 100 ms is enough to ride out scheduling hiccups and short
 * enough that dropping is better than the latency.
 */
export const MAX_QUEUED_BYTES = MIX_CHUNK_BYTES * 10;

interface Source {
  queue: Buffer[];
  queued: number;
  /** Bytes dropped because this source ran too far ahead, for diagnostics. */
  dropped: number;
}

export class AudioMixer {
  private sources = new Map<string, Source>();

  add(id: string): void {
    if (this.sources.has(id)) return;
    this.sources.set(id, { queue: [], queued: 0, dropped: 0 });
  }

  remove(id: string): void {
    this.sources.delete(id);
  }

  has(id: string): boolean {
    return this.sources.has(id);
  }

  ids(): string[] {
    return [...this.sources.keys()];
  }

  droppedBytes(id: string): number {
    return this.sources.get(id)?.dropped ?? 0;
  }

  push(id: string, chunk: Buffer): void {
    const source = this.sources.get(id);
    if (!source || chunk.byteLength === 0) return;

    source.queue.push(chunk);
    source.queued += chunk.byteLength;

    while (source.queued > MAX_QUEUED_BYTES) {
      const oldest = source.queue[0];
      const over = source.queued - MAX_QUEUED_BYTES;

      if (oldest.byteLength <= over) {
        source.queue.shift();
        source.queued -= oldest.byteLength;
        source.dropped += oldest.byteLength;
      } else {
        source.queue[0] = oldest.subarray(over);
        source.queued -= over;
        source.dropped += over;
      }
    }
  }

  /**
   * The mixed audio that is ready, in whole chunks.
   *
   * A source with less than a chunk queued contributes what it has and silence
   * for the rest, rather than holding everyone else up: the capture processes
   * are not in lockstep and one being a few milliseconds late is normal.
   * Returns null when no source has a full chunk to give.
   */
  pull(): Buffer | null {
    if (this.sources.size === 0) return null;

    let ready = false;
    for (const source of this.sources.values()) {
      if (source.queued >= MIX_CHUNK_BYTES) {
        ready = true;
        break;
      }
    }
    if (!ready) return null;

    const mixed = Buffer.alloc(MIX_CHUNK_BYTES);
    let mixedAny = false;

    for (const source of this.sources.values()) {
      const taken = this.take(source, MIX_CHUNK_BYTES);
      if (!taken) continue;

      if (!mixedAny) {
        taken.copy(mixed);
        mixedAny = true;
        continue;
      }

      for (let offset = 0; offset + 1 < taken.byteLength; offset += 2) {
        const sum = mixed.readInt16LE(offset) + taken.readInt16LE(offset);
        mixed.writeInt16LE(Math.max(-32768, Math.min(32767, sum)), offset);
      }
    }

    return mixed;
  }

  /** Up to `wanted` bytes off the front of a source, zero-padded to length. */
  private take(source: Source, wanted: number): Buffer | null {
    if (source.queued === 0) return null;

    const out = Buffer.alloc(wanted);
    let written = 0;

    while (written < wanted && source.queue.length > 0) {
      const head = source.queue[0];
      const room = wanted - written;

      if (head.byteLength <= room) {
        head.copy(out, written);
        written += head.byteLength;
        source.queue.shift();
        source.queued -= head.byteLength;
      } else {
        head.copy(out, written, 0, room);
        source.queue[0] = head.subarray(room);
        source.queued -= room;
        written += room;
      }
    }

    return out;
  }
}
