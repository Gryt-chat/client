/** A live video track, rather than a stream object that outlived the media on it. */
export function hasLiveVideoTrack(stream: MediaStream | undefined | null): boolean {
  if (!stream) return false;

  return stream.getVideoTracks().some((track) => track.readyState === "live");
}

/**
 * The stream a remote camera is drawn from: the one its owner announced, or the stream the
 * frames actually arrived on when that id names nothing we have (GRYT-1251).
 */
export function cameraStreamFor(
  announced: string | undefined | null,
  fallback: string | undefined | null,
  videoStreams: Record<string, MediaStream> | undefined,
): MediaStream | null {
  if (announced && videoStreams?.[announced]) return videoStreams[announced];
  if (fallback && videoStreams?.[fallback]) return videoStreams[fallback];
  return null;
}
