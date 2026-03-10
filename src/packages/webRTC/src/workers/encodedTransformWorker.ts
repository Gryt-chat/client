// WebRTC Encoded Transform worker.
//
// Receives pre-encoded H.264 NAL units from the main thread via a
// MessagePort and replaces outgoing RTCEncodedVideoFrame data in the
// WebRTC pipeline, bypassing the browser's internal re-encode cycle.

interface PreEncodedFrame {
  data: ArrayBuffer;
  keyframe: boolean;
  timestamp: number;
}

interface RTCEncodedVideoFrame {
  type: "key" | "delta" | "empty";
  readonly timestamp: number;
  data: ArrayBuffer;
  getMetadata(): Record<string, unknown>;
}

interface RTCTransformer {
  readable: ReadableStream<RTCEncodedVideoFrame>;
  writable: WritableStream<RTCEncodedVideoFrame>;
  options: { framePort: MessagePort };
}

interface RTCTransformEvent extends Event {
  transformer: RTCTransformer;
}

const frameQueue: PreEncodedFrame[] = [];
const MAX_QUEUE = 4;

function onFrame(frame: PreEncodedFrame) {
  frameQueue.push(frame);
  while (frameQueue.length > MAX_QUEUE) frameQueue.shift();
}

self.addEventListener("rtctransform", (evt: Event) => {
  const { readable, writable, options } = (evt as RTCTransformEvent).transformer;
  const port = options.framePort;

  port.onmessage = (msg: MessageEvent<PreEncodedFrame>) => onFrame(msg.data);

  const transform = new TransformStream<RTCEncodedVideoFrame, RTCEncodedVideoFrame>({
    transform(frame, controller) {
      const preEncoded = frameQueue.shift();
      if (preEncoded) {
        frame.data = preEncoded.data;
      }
      controller.enqueue(frame);
    },
  });

  readable.pipeThrough(transform).pipeTo(writable);
});
