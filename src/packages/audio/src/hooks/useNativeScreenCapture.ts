import { useCallback, useEffect, useRef, useState } from "react";

import { getElectronAPI, isElectron } from "../../../../lib/electron";

export type EncodedFrameCallback = (data: ArrayBuffer, keyframe: boolean, timestamp: number) => void;

export interface NativeScreenCapture {
  available: boolean;
  active: boolean;
  videoStream: MediaStream | null;
  /** Which codec the native HW encoder is using, or null if raw/inactive */
  encodedCodec: "h264" | "hevc" | null;
  /** Subscribe to pre-encoded NAL frames. Returns unsubscribe function. */
  subscribeEncodedFrames: (cb: EncodedFrameCallback) => () => void;
  start: (monitorIndex: number, fps: number, maxWidth?: number, maxHeight?: number, bitrate?: number, codec?: string) => Promise<boolean>;
  stop: () => void;
}

function isMediaStreamTrackGeneratorSupported(): boolean {
  return typeof MediaStreamTrackGenerator !== "undefined";
}

function isVideoDecoderSupported(): boolean {
  return typeof VideoDecoder !== "undefined";
}

// Frame protocol type bytes (must match native binary)
const TYPE_RAW_I420 = 0;
const TYPE_ENCODED  = 1;
const TYPE_CONFIG   = 2;

// Codec types (must match CodecType enum in encoder.h)
const CODEC_H264 = 0;
const CODEC_HEVC = 1;

function buildCodecString(codecType: number, profile: number, level: number): string {
  if (codecType === CODEC_HEVC) {
    // hev1.<profile>.<compat>.<tier><level>
    // profile 1 = Main, compat flags 6 = general_profile_compatibility_flag[1..2]
    // "L" prefix = Main tier, level_idc is the raw value (e.g., 93=3.1, 120=4.0, 150=5.0, 153=5.1)
    return `hev1.1.6.L${level}.B0`;
  }
  // H.264: avc3.PPCCLL (Annex B format, SPS/PPS inline)
  return `avc3.${profile.toString(16).padStart(2, "0")}00${level.toString(16).padStart(2, "0")}`;
}

export function useNativeScreenCapture(): NativeScreenCapture {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [encodedCodec, setEncodedCodec] = useState<"h264" | "hevc" | null>(null);

  const generatorRef = useRef<MediaStreamTrackGenerator | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<VideoFrame> | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);
  const activeRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const encodedFrameListenersRef = useRef<Set<EncodedFrameCallback>>(new Set());

  const subscribeEncodedFrames = useCallback((cb: EncodedFrameCallback) => {
    encodedFrameListenersRef.current.add(cb);
    return () => { encodedFrameListenersRef.current.delete(cb); };
  }, []);

  useEffect(() => {
    if (!isElectron()) return;
    if (!isMediaStreamTrackGeneratorSupported()) {
      console.warn("[NativeScreenCapture] MediaStreamTrackGenerator not supported");
      return;
    }

    const api = getElectronAPI();
    if (!api) return;

    let cancelled = false;

    async function probe(attempt: number) {
      try {
        const v = await api!.isNativeScreenCaptureAvailable();
        if (!cancelled) {
          console.log(`[NativeScreenCapture] availability: ${v}`);
          setAvailable(v);
        }
      } catch (err) {
        if (cancelled) return;
        if (attempt < 3) {
          setTimeout(() => probe(attempt + 1), 500 * attempt);
        } else {
          console.error("[NativeScreenCapture] probe failed", err);
        }
      }
    }

    probe(1);
    return () => { cancelled = true; };
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;

    if (decoderRef.current) {
      try { decoderRef.current.close(); } catch { /* already closed */ }
      decoderRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const api = getElectronAPI();
    api?.stopNativeScreenCapture();

    if (writerRef.current) {
      writerRef.current.close().catch(() => {});
      writerRef.current = null;
    }
    if (generatorRef.current) {
      generatorRef.current.stop();
      generatorRef.current = null;
    }

    for (const unsub of cleanupRef.current) unsub();
    cleanupRef.current = [];

    setVideoStream(null);
    setActive(false);
    setEncodedCodec(null);
    encodedFrameListenersRef.current.clear();
  }, []);

  const start = useCallback(
    async (monitorIndex: number, fps: number, maxWidth?: number, maxHeight?: number, bitrate?: number, codec?: string): Promise<boolean> => {
      const api = getElectronAPI();
      if (!api || !isMediaStreamTrackGeneratorSupported()) return false;

      const generator = new MediaStreamTrackGenerator({ kind: "video" });
      const writer = generator.writable.getWriter();
      generatorRef.current = generator;
      writerRef.current = writer;

      let framesReceived = 0;
      let lastLogTime = Date.now();

      const logFps = () => {
        framesReceived++;
        const now = Date.now();
        if (now - lastLogTime >= 5000) {
          const elapsed = (now - lastLogTime) / 1000;
          console.log(`[NativeScreenCapture] renderer: ${(framesReceived / elapsed).toFixed(1)} fps`);
          framesReceived = 0;
          lastLogTime = now;
        }
      };

      const writeFrame = (frame: VideoFrame) => {
        if (!activeRef.current) { frame.close(); return; }
        writer.write(frame).catch(() => {});
        frame.close();
        logFps();
      };

      const processRawFrame = (data: ArrayBuffer, width: number, height: number, timestampUs: number) => {
        if (!activeRef.current) return;
        try {
          const videoFrame = new VideoFrame(new Uint8Array(data), {
            format: "I420",
            codedWidth: width,
            codedHeight: height,
            timestamp: timestampUs,
          });
          writeFrame(videoFrame);
        } catch (err) {
          if (framesReceived === 0) {
            console.error("[NativeScreenCapture] VideoFrame creation failed:", err);
          }
        }
      };

      const unsubStopped = api.onNativeScreenCaptureStopped(() => {
        console.log("[NativeScreenCapture] native process stopped");
        stop();
      });
      cleanupRef.current = [unsubStopped];

      const result = await api.startNativeScreenCapture(monitorIndex, fps, maxWidth, maxHeight, bitrate, codec);
      if (!result.success) {
        console.error("[NativeScreenCapture] failed to start native capture");
        stop();
        return false;
      }

      if (result.wsPort) {
        console.log(`[NativeScreenCapture] connecting via WebSocket on port ${result.wsPort}`);
        const ws = new WebSocket(`ws://127.0.0.1:${result.wsPort}`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        let encodedMode = false;
        let decoderReady = false;

        const wsReady = new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            console.error("[NativeScreenCapture] WebSocket open timeout (3s)");
            resolve(false);
          }, 3000);

          ws.onopen = () => {
            clearTimeout(timeout);
            console.log("[NativeScreenCapture] WebSocket connected");
            resolve(true);
          };

          ws.onerror = (err) => {
            clearTimeout(timeout);
            console.error("[NativeScreenCapture] WebSocket error:", err);
            resolve(false);
          };
        });

        const opened = await wsReady;
        if (!opened) {
          console.error("[NativeScreenCapture] WebSocket failed to connect, falling back");
          wsRef.current = null;
          try { ws.close(); } catch { /* ignore */ }
          stop();
          return false;
        }

        ws.onmessage = (event: MessageEvent) => {
          const buf = event.data as ArrayBuffer;
          if (buf.byteLength < 1) return;
          const view = new DataView(buf);
          const type = view.getUint8(0);

          if (type === TYPE_CONFIG) {
            if (buf.byteLength < 12) return;
            const cfgW = view.getUint32(1, true);
            const cfgH = view.getUint32(5, true);
            const codecType = view.getUint8(9);
            const profile = view.getUint8(10);
            const level = view.getUint8(11);

            const codecStr = buildCodecString(codecType, profile, level);
            const codecName = codecType === CODEC_HEVC ? "HEVC" : "H.264";
            console.log(`[NativeScreenCapture] ${codecName} config: ${cfgW}x${cfgH} codec=${codecStr}`);

            if (isVideoDecoderSupported()) {
              try {
                const decoder = new VideoDecoder({
                  output: (frame: VideoFrame) => writeFrame(frame),
                  error: (e: DOMException) => console.error("[NativeScreenCapture] decoder error:", e),
                });
                decoder.configure({
                  codec: codecStr,
                  codedWidth: cfgW,
                  codedHeight: cfgH,
                  optimizeForLatency: true,
                });
                decoderRef.current = decoder;
                encodedMode = true;
                decoderReady = true;
                setEncodedCodec(codecType === CODEC_HEVC ? "hevc" : "h264");
                console.log(`[NativeScreenCapture] VideoDecoder configured for ${codecName} HW-encoded stream`);
              } catch (err) {
                console.warn("[NativeScreenCapture] VideoDecoder setup failed, expecting raw frames:", err);
              }
            }
            return;
          }

          if (type === TYPE_ENCODED && encodedMode && decoderReady) {
            if (buf.byteLength < 18) return;
            const keyframe = view.getUint8(1) !== 0;
            const tsLow = view.getUint32(10, true);
            const tsHigh = view.getInt32(14, true);
            const timestampUs = tsHigh * 0x100000000 + tsLow;
            const nalData = buf.slice(18);

            for (const cb of encodedFrameListenersRef.current) {
              cb(nalData, keyframe, timestampUs);
            }

            try {
              const chunk = new EncodedVideoChunk({
                type: keyframe ? "key" : "delta",
                timestamp: timestampUs,
                data: nalData,
              });
              decoderRef.current!.decode(chunk);
            } catch (err) {
              if (framesReceived === 0) {
                console.error("[NativeScreenCapture] decode failed:", err);
              }
            }
            logFps();
            return;
          }

          if (type === TYPE_RAW_I420) {
            if (buf.byteLength < 17) return;
            const width = view.getUint32(1, true);
            const height = view.getUint32(5, true);
            const tsLow = view.getUint32(9, true);
            const tsHigh = view.getInt32(13, true);
            const timestampUs = tsHigh * 0x100000000 + tsLow;
            const i420Data = buf.slice(17);
            processRawFrame(i420Data, width, height, timestampUs);
            return;
          }

          if (buf.byteLength >= 16) {
            const width = view.getUint32(0, true);
            const height = view.getUint32(4, true);
            if (width > 2 && width < 16384 && height > 2 && height < 16384) {
              const tsLow = view.getUint32(8, true);
              const tsHigh = view.getInt32(12, true);
              const timestampUs = tsHigh * 0x100000000 + tsLow;
              const i420Data = buf.slice(16);
              processRawFrame(i420Data, width, height, timestampUs);
            }
          }
        };

        ws.onerror = (err) => {
          console.error("[NativeScreenCapture] WebSocket error:", err);
        };

        ws.onclose = () => {
          console.log("[NativeScreenCapture] WebSocket closed");
          if (activeRef.current) stop();
        };
      } else {
        // Legacy IPC fallback for older binaries without --ws support
        console.log("[NativeScreenCapture] using legacy IPC frame relay");
        const unsubFrame = api.onNativeScreenFrame((frame) => {
          processRawFrame(frame.data, frame.width, frame.height, frame.timestampUs);
        });
        cleanupRef.current.push(unsubFrame);
      }

      activeRef.current = true;
      generator.contentHint = "motion";
      const stream = new MediaStream([generator]);
      setVideoStream(stream);
      setActive(true);

      console.log(`[NativeScreenCapture] started: monitor=${monitorIndex} fps=${fps} res=${maxWidth ?? "native"}x=${maxHeight ?? "native"} ws=${!!result.wsPort}`);
      return true;
    },
    [stop],
  );

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { available, active, videoStream, encodedCodec, subscribeEncodedFrames, start, stop };
}
