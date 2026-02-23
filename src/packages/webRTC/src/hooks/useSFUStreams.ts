import { Dispatch, MutableRefObject, SetStateAction, useEffect, useRef } from "react";
import { Socket } from "socket.io-client";

import { sliderToOutputGain } from "@/lib/audioVolume";

import { Streams, StreamSources, VideoStreams } from "../types/SFU";
import { voiceLog } from "./voiceLogger";

interface UseSFUStreamsParams {
  streams: Streams;
  setStreams: Dispatch<SetStateAction<Streams>>;
  streamSources: StreamSources;
  setStreamSources: Dispatch<SetStateAction<StreamSources>>;
  setVideoStreams: Dispatch<SetStateAction<VideoStreams>>;
  audioContext: AudioContext | null | undefined;
  remoteBusNode: GainNode | undefined;
  outputVolume: number;
  isDeafened: boolean;
  isConnected: boolean;
  connectionServerId: string | null;
  sockets: Record<string, Socket>;
  previousRemoteStreamsRef: MutableRefObject<Set<string>>;
}

export function useSFUStreams({
  streams,
  setStreams,
  streamSources,
  setStreamSources,
  setVideoStreams,
  audioContext,
  remoteBusNode,
  outputVolume,
  isDeafened,
  isConnected,
  connectionServerId,
  sockets,
  previousRemoteStreamsRef,
}: UseSFUStreamsParams): void {
  const streamsRef = useRef(streams);
  streamsRef.current = streams;
  // Track peer connections and emit events when peers join/leave
  useEffect(() => {
    if (!isConnected) {
      previousRemoteStreamsRef.current.clear();
      return;
    }

    const currentRemoteStreams = new Set<string>();
    Object.entries(streams).forEach(([streamId, streamData]) => {
      if (!streamData.isLocal) {
        currentRemoteStreams.add(streamId);
      }
    });

    const previousRemoteStreams = previousRemoteStreamsRef.current;

    const newPeers = [...currentRemoteStreams].filter(streamId => !previousRemoteStreams.has(streamId));
    const disconnectedPeers = [...previousRemoteStreams].filter(streamId => !currentRemoteStreams.has(streamId));

    if (newPeers.length > 0) {
      if (connectionServerId && sockets[connectionServerId]) {
        const socket = sockets[connectionServerId];
        newPeers.forEach(streamId => {
          socket.emit("voice:peer:connected", streamId);
        });
      }
    }

    if (disconnectedPeers.length > 0) {
      if (connectionServerId && sockets[connectionServerId]) {
        const socket = sockets[connectionServerId];
        disconnectedPeers.forEach(streamId => {
          socket.emit("voice:peer:disconnected", streamId);
        });
      }
    }

    previousRemoteStreamsRef.current = currentRemoteStreams;
  }, [streams, isConnected, connectionServerId, sockets, previousRemoteStreamsRef]);

  // Cleanup stale streamSources when streams are removed
  useEffect(() => {
    const staleIds = Object.keys(streamSources).filter((id) => streams[id] === undefined);
    if (staleIds.length === 0) return;

    staleIds.forEach((id) => {
      try {
        const source = streamSources[id];
        source.gain.disconnect();
        source.analyser.disconnect();
        source.stream.disconnect();
        if (source.audioElement) {
          source.audioElement.pause();
          source.audioElement.srcObject = null;
          source.audioElement.remove();
        }
      } catch { /* already disconnected */ }
    });

    setStreamSources((prev) => {
      const next = { ...prev };
      staleIds.forEach((id) => delete next[id]);
      return next;
    });
  }, [streams, streamSources, setStreamSources]);

  // Setup audio processing (sourceNode/analyser/gainNode) per remote stream
  useEffect(() => {
    if (!audioContext) {
      voiceLog.warn("WEBRTC", "useSFUStreams: no audioContext — skipping playback setup");
      return;
    }

    const newStreamSources: StreamSources = { ...streamSources };
    let hasChanges = false;

    Object.keys(streams).forEach((streamID) => {
      const stream = streams[streamID];

      if (stream.isLocal) return;
      if (streamSources[streamID]) return;

      const audioTracks = stream.stream.getAudioTracks();
      if (!audioTracks.length) {
        voiceLog.warn("WEBRTC", `Remote stream ${streamID} has 0 audio tracks — skipping`);
        return;
      }

      voiceLog.step("WEBRTC", "PLAY", `Setting up playback for remote stream ${streamID}`, {
        trackCount: audioTracks.length,
        tracks: audioTracks.map(t => ({ id: t.id, readyState: t.readyState, enabled: t.enabled, muted: t.muted })),
        audioContextState: audioContext.state,
        outputVolume,
        isDeafened,
      });

      try {
        // Use an HTMLAudioElement to ensure Chrome decodes the WebRTC stream.
        // createMediaStreamSource() alone doesn't always trigger the decoder.
        const audioEl = new Audio();
        audioEl.srcObject = stream.stream;
        audioEl.autoplay = true;
        // Mute the element itself — all volume goes through the Web Audio gain node
        audioEl.volume = 0;
        audioEl.play().catch(e => voiceLog.warn("WEBRTC", `Audio element play() rejected: ${e.message}`));

        const sourceNode = audioContext.createMediaStreamSource(stream.stream);
        const analyserNode = audioContext.createAnalyser();
        const gainNode = audioContext.createGain();

        const outputGain = isDeafened ? 0 : sliderToOutputGain(outputVolume);
        gainNode.gain.value = outputGain;

        sourceNode.connect(analyserNode);
        analyserNode.connect(gainNode);
        const destination = remoteBusNode ?? audioContext.destination;
        gainNode.connect(destination);

        voiceLog.ok("WEBRTC", "PLAY", `Playback connected: stream ${streamID} → analyser → gain(${outputGain.toFixed(2)}) → speakers`, {
          audioContextState: audioContext.state,
          destinationChannels: audioContext.destination.maxChannelCount,
        });

        newStreamSources[streamID] = {
          gain: gainNode,
          analyser: analyserNode,
          stream: sourceNode,
          audioElement: audioEl,
        };

        hasChanges = true;
      } catch (error) {
        voiceLog.fail("WEBRTC", "PLAY", `Failed to setup playback for stream ${streamID}`, error);
      }
    });

    if (hasChanges) {
      setStreamSources(newStreamSources);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams, audioContext, streamSources, setStreamSources]);

  // Update output volume for all streams when setting changes
  useEffect(() => {
    const outputGain = isDeafened ? 0 : sliderToOutputGain(outputVolume);

    Object.values(streamSources).forEach(({ gain }) => {
      if (gain) {
        gain.gain.setValueAtTime(outputGain, audioContext?.currentTime || 0);
      }
    });
  }, [outputVolume, isDeafened, streamSources, audioContext]);

  // Safety net: periodically remove streams whose tracks have all ended.
  // Handles edge cases where track.onended doesn't fire (ICE failure, etc).
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      const current = streamsRef.current;
      const deadIds: string[] = [];
      Object.entries(current).forEach(([id, data]) => {
        if (data.isLocal) return;
        const tracks = data.stream.getTracks();
        if (tracks.length === 0 || tracks.every(t => t.readyState === "ended")) {
          deadIds.push(id);
        }
      });
      if (deadIds.length > 0) {
        voiceLog.info("WEBRTC", `Orphan cleanup: removing ${deadIds.length} dead stream(s): ${deadIds.join(", ")}`);
        setStreams(prev => {
          const next = { ...prev };
          deadIds.forEach(id => delete next[id]);
          return next;
        });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [isConnected, setStreams]);

  // Track the first stream ID seen for each track so we can alias after
  // SFU renegotiations that assign new stream IDs to the same tracks.
  const trackToOriginalStreamRef = useRef<Map<string, string>>(new Map());

  // Extract video MediaStreams from remote streams for rendering in VoiceView
  useEffect(() => {
    const nextVideo: VideoStreams = {};
    const trackMap = trackToOriginalStreamRef.current;

    Object.entries(streams).forEach(([streamId, data]) => {
      if (data.isLocal) return;
      const videoTracks = data.stream.getVideoTracks();
      if (videoTracks.length > 0 && videoTracks.some(t => t.readyState === "live")) {
        nextVideo[streamId] = data.stream;

        for (const track of videoTracks) {
          const originalId = trackMap.get(track.id);
          if (!originalId) {
            trackMap.set(track.id, streamId);
          } else if (originalId !== streamId) {
            nextVideo[originalId] = data.stream;
          }
        }
      }
    });

    setVideoStreams(prev => {
      const prevKeys = Object.keys(prev).sort().join(",");
      const nextKeys = Object.keys(nextVideo).sort().join(",");
      if (prevKeys === nextKeys) return prev;
      return nextVideo;
    });
  }, [streams, setVideoStreams]);
}
