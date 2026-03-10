export function isEncodedTransformSupported(): boolean {
  return typeof RTCRtpScriptTransform !== "undefined";
}

export interface EncodedTransformHandle {
  feedFrame: (data: ArrayBuffer, keyframe: boolean, timestamp: number) => void;
  detach: () => void;
}

export function attachEncodedTransform(sender: RTCRtpSender): EncodedTransformHandle | null {
  if (!isEncodedTransformSupported()) return null;

  const channel = new MessageChannel();
  const worker = new Worker(
    new URL("../workers/encodedTransformWorker.ts", import.meta.url),
    { type: "module", name: "encoded-transform" },
  );

  sender.transform = new RTCRtpScriptTransform(
    worker,
    { framePort: channel.port2 },
    [channel.port2],
  );

  const feedFrame = (data: ArrayBuffer, keyframe: boolean, timestamp: number) => {
    channel.port1.postMessage({ data, keyframe, timestamp });
  };

  const detach = () => {
    sender.transform = null;
    channel.port1.close();
    worker.terminate();
  };

  return { feedFrame, detach };
}
