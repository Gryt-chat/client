/// <reference types="vite/client" />

declare global {
  const __APP_VERSION__: string;

  interface Window {
    __GRYT_CONFIG__?: {
      GRYT_OIDC_ISSUER?: string;
      GRYT_OIDC_REALM?: string;
      GRYT_OIDC_CLIENT_ID?: string;
    };
  }

  interface RTCRtpEncodingParameters {
    scalabilityMode?: string;
  }

  /** Experimental: Insertable Streams – writable video track generator */
  class MediaStreamTrackGenerator extends MediaStreamTrack {
    constructor(init: { kind: "video" | "audio" });
    readonly writable: WritableStream<VideoFrame>;
  }

  interface VideoFrameBufferInit {
    format: "I420" | "I420A" | "I422" | "I444" | "NV12" | "RGBA" | "RGBX" | "BGRA" | "BGRX";
    codedWidth: number;
    codedHeight: number;
    timestamp: number;
    duration?: number;
    layout?: Array<{ offset: number; stride: number }>;
    visibleRect?: { x: number; y: number; width: number; height: number };
    displayWidth?: number;
    displayHeight?: number;
    colorSpace?: VideoColorSpaceInit;
  }

  class VideoFrame {
    constructor(data: BufferSource, init: VideoFrameBufferInit);
    constructor(image: CanvasImageSource, init?: { timestamp: number; duration?: number });
    readonly codedWidth: number;
    readonly codedHeight: number;
    readonly timestamp: number;
    readonly format: string | null;
    close(): void;
  }

  /** WebRTC Encoded Transforms (Insertable Streams) */
  class RTCRtpScriptTransform {
    constructor(worker: Worker, options?: Record<string, unknown>, transfer?: Transferable[]);
  }

  interface RTCRtpSender {
    transform: RTCRtpScriptTransform | null;
  }

  interface RTCEncodedVideoFrame {
    readonly type: "key" | "delta" | "empty";
    readonly timestamp: number;
    data: ArrayBuffer;
    readonly metadata: RTCEncodedVideoFrameMetadata;
    getMetadata(): RTCEncodedVideoFrameMetadata;
  }

  interface RTCEncodedVideoFrameMetadata {
    synchronizationSource?: number;
    contributingSources?: number[];
    payloadType?: number;
    frameId?: number;
    dependencies?: number[];
    width?: number;
    height?: number;
    temporalIndex?: number;
    spatialIndex?: number;
  }

  /** WebCodecs: encoded video chunk for feeding to VideoDecoder */
  class EncodedVideoChunk {
    constructor(init: {
      type: "key" | "delta";
      timestamp: number;
      duration?: number;
      data: BufferSource;
    });
    readonly type: "key" | "delta";
    readonly timestamp: number;
    readonly byteLength: number;
  }

  /** WebCodecs: hardware-accelerated video decoder */
  class VideoDecoder {
    constructor(init: {
      output: (frame: VideoFrame) => void;
      error: (error: DOMException) => void;
    });
    configure(config: {
      codec: string;
      codedWidth?: number;
      codedHeight?: number;
      description?: BufferSource;
      optimizeForLatency?: boolean;
    }): void;
    decode(chunk: EncodedVideoChunk): void;
    flush(): Promise<void>;
    close(): void;
    readonly state: "unconfigured" | "configured" | "closed";
    readonly decodeQueueSize: number;
    static isConfigSupported(config: {
      codec: string;
      codedWidth?: number;
      codedHeight?: number;
    }): Promise<{ supported: boolean }>;
  }
}

export {};
