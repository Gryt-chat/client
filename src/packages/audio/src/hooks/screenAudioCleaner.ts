/**
 * Subtracts remote peer audio from screen-capture audio so that
 * the outgoing screen-share stream only contains external sounds
 * (game audio, music, etc.) — not the voices of other Gryt users.
 *
 * Signal flow:
 *
 *   screenCaptureTrack ──► sourceNode ──────────────────────────┐
 *                                                               ├──► destination (cleaned)
 *   remoteBusNode ──► delayNode ──► invertGain (gain = -1) ─────┘
 *
 * The `remoteBusNode` carries the mixed audio of every remote peer.
 * Phase-inverting it and summing with the capture cancels the app's
 * own playback out of the stream.
 *
 * The OS audio pipeline adds latency between audioContext.destination
 * and the loopback captured by getDisplayMedia. `latencyOffsetSec`
 * compensates for this so the inverted signal aligns in time with
 * the captured version, giving cleaner cancellation.
 */

export interface ScreenAudioCleanerResult {
  cleanedStream: MediaStream;
  delayNode: DelayNode;
  dispose: () => void;
}

export function createScreenAudioCleaner(
  audioContext: AudioContext,
  rawScreenAudioTrack: MediaStreamTrack,
  remoteBusNode: GainNode,
  latencyOffsetSec: number = 0,
): ScreenAudioCleanerResult {
  const source = audioContext.createMediaStreamSource(
    new MediaStream([rawScreenAudioTrack]),
  );

  const invertGain = audioContext.createGain();
  invertGain.gain.value = -1;

  const destination = audioContext.createMediaStreamDestination();

  source.connect(destination);

  const delayNode = audioContext.createDelay(1.0);
  delayNode.delayTime.value = latencyOffsetSec;
  remoteBusNode.connect(delayNode);
  delayNode.connect(invertGain);
  invertGain.connect(destination);

  const cleanedStream = destination.stream;

  const dispose = () => {
    try { source.disconnect(); } catch { /* already disconnected */ }
    try { invertGain.disconnect(); } catch { /* already disconnected */ }
    try { delayNode.disconnect(); } catch { /* already disconnected */ }
    try { remoteBusNode.disconnect(delayNode); } catch { /* already disconnected */ }
  };

  return { cleanedStream, delayNode, dispose };
}
