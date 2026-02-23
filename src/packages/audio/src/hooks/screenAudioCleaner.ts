/**
 * Subtracts remote peer audio from screen-capture audio so that
 * the outgoing screen-share stream only contains external sounds
 * (game audio, music, etc.) — not the voices of other Gryt users.
 *
 * Signal flow:
 *
 *   screenCaptureTrack ──► sourceNode ─────────────────┐
 *                                                      ├──► destination (cleaned stream)
 *   remoteBusNode ──► invertGain (gain = -1) ──────────┘
 *
 * The `remoteBusNode` carries the mixed audio of every remote peer.
 * Phase-inverting it and summing with the capture cancels the app's
 * own playback out of the stream.
 */

export interface ScreenAudioCleanerResult {
  cleanedStream: MediaStream;
  dispose: () => void;
}

export function createScreenAudioCleaner(
  audioContext: AudioContext,
  rawScreenAudioTrack: MediaStreamTrack,
  remoteBusNode: GainNode,
): ScreenAudioCleanerResult {
  const source = audioContext.createMediaStreamSource(
    new MediaStream([rawScreenAudioTrack]),
  );

  const invertGain = audioContext.createGain();
  invertGain.gain.value = -1;

  const destination = audioContext.createMediaStreamDestination();

  source.connect(destination);
  remoteBusNode.connect(invertGain);
  invertGain.connect(destination);

  const cleanedStream = destination.stream;

  const dispose = () => {
    try { source.disconnect(); } catch { /* already disconnected */ }
    try { invertGain.disconnect(); } catch { /* already disconnected */ }
    try { remoteBusNode.disconnect(invertGain); } catch { /* already disconnected */ }
  };

  return { cleanedStream, dispose };
}
