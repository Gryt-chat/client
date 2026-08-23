/* eslint-env node */

/**
 * The PCM mixer in electron/audioMixer.ts.
 *
 * Capturing several applications means one child process each, and what the
 * renderer gets is their sum. None of that can be run here — process loopback
 * per application is Windows only — so the arithmetic and the queueing are
 * checked directly instead.
 */

import assert from "node:assert/strict";

import { AudioMixer, MAX_QUEUED_BYTES, MIX_CHUNK_BYTES } from "../electron/audioMixer.ts";

/** A chunk of `frames` stereo frames where every sample is `value`. */
function pcm(value, frames = MIX_CHUNK_BYTES / 4) {
  const buf = Buffer.alloc(frames * 4);
  for (let offset = 0; offset + 1 < buf.byteLength; offset += 2) {
    buf.writeInt16LE(value, offset);
  }
  return buf;
}

function firstSample(buf) {
  return buf.readInt16LE(0);
}

// One source passes through untouched, a chunk at a time.
{
  const mixer = new AudioMixer();
  mixer.add("a");
  assert.equal(mixer.pull(), null, "nothing queued yet");

  mixer.push("a", pcm(1000));
  mixer.push("a", pcm(2000));

  assert.equal(firstSample(mixer.pull()), 1000);
  assert.equal(firstSample(mixer.pull()), 2000);
  assert.equal(mixer.pull(), null);
}

// Two sources sum.
{
  const mixer = new AudioMixer();
  mixer.add("a");
  mixer.add("b");
  mixer.push("a", pcm(100));
  mixer.push("b", pcm(200));

  assert.equal(firstSample(mixer.pull()), 300);
}

// Loud plus loud clips instead of wrapping to a negative number, which is what
// it would do if the sum were written back as Int16 unclamped.
{
  const mixer = new AudioMixer();
  mixer.add("a");
  mixer.add("b");
  mixer.push("a", pcm(30000));
  mixer.push("b", pcm(30000));

  assert.equal(firstSample(mixer.pull()), 32767);
}

// A source with less than a chunk contributes what it has and silence for the
// rest, rather than holding up every other source.
{
  const mixer = new AudioMixer();
  mixer.add("a");
  mixer.add("b");
  mixer.push("a", pcm(100));
  mixer.push("b", pcm(200, MIX_CHUNK_BYTES / 8));

  const out = mixer.pull();
  assert.equal(firstSample(out), 300);
  assert.equal(out.readInt16LE(MIX_CHUNK_BYTES - 2), 100, "b ran out, a keeps going");
}

// A source that runs ahead is trimmed from the front. Keeping it all would put
// it further and further behind the others.
{
  const mixer = new AudioMixer();
  mixer.add("a");
  for (let i = 0; i < 20; i++) mixer.push("a", pcm(i + 1));

  assert.ok(mixer.droppedBytes("a") > 0, "something was dropped");
  assert.equal(mixer.droppedBytes("a"), 20 * MIX_CHUNK_BYTES - MAX_QUEUED_BYTES);

  // What survives is the newest audio, so the first chunk out is not the first
  // chunk in.
  assert.ok(firstSample(mixer.pull()) > 1);
}

// Sources come and go while a share is running.
{
  const mixer = new AudioMixer();
  mixer.add("a");
  mixer.add("b");
  assert.deepEqual(mixer.ids(), ["a", "b"]);

  mixer.remove("b");
  assert.equal(mixer.has("b"), false);

  mixer.push("b", pcm(500));
  mixer.push("a", pcm(100));
  assert.equal(firstSample(mixer.pull()), 100, "a removed source is not mixed");

  mixer.remove("a");
  assert.equal(mixer.pull(), null, "no sources, nothing to send");
}

console.log("audio mixer ok");
