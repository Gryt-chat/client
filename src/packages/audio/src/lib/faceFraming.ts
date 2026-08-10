/**
 * Where a face sits in the frame, as a fraction of width and height.
 *
 * 0.5, 0.5 is dead centre and is what everything falls back to. These map
 * straight onto CSS object-position on the receiving side, which is the whole
 * reason the value is normalised rather than in pixels: the receiver's tile is
 * a different size and shape from the sender's camera.
 */
export type Framing = { x: number; y: number };

export const CENTRED: Framing = { x: 0.5, y: 0.5 };

/** Inference happens on a frame this wide. BlazeFace does not need more. */
const SAMPLE_WIDTH = 192;

/** Below this, the detection is not trusted enough to move anyone's crop. */
const MIN_CONFIDENCE = 0.5;

type Detector = {
  detect: (source: HTMLCanvasElement) => {
    detections: Array<{
      categories?: Array<{ score: number }>;
      boundingBox?: {
        originX: number;
        originY: number;
        width: number;
        height: number;
      };
    }>;
  };
  close: () => void;
};

let detectorPromise: Promise<Detector | null> | null = null;

/**
 * Loads the model once per session, and only when something asks for it.
 *
 * The import is dynamic so the 12 MB of WASM stays out of the main bundle for
 * everyone who never turns this on.
 */
async function getDetector(): Promise<Detector | null> {
  if (detectorPromise) return detectorPromise;

  detectorPromise = (async () => {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe");
      const detector = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "/models/blaze_face_short_range.tflite",
          delegate: "GPU",
        },
        // IMAGE rather than VIDEO: this runs once when asked, not per frame,
        // so there is no timestamped stream for the model to track across.
        runningMode: "IMAGE",
        minDetectionConfidence: MIN_CONFIDENCE,
      });
      return detector as unknown as Detector;
    } catch (err) {
      console.warn("[FaceFraming] detector unavailable:", err);
      return null;
    }
  })();

  return detectorPromise;
}

/**
 * Finds the largest face in one frame of a camera stream.
 *
 * Runs on the sender, once, when asked. Continuous tracking was the obvious
 * design and the wrong one: a tile that follows your head in real time is
 * distracting to watch, and it spends CPU on a machine already encoding video
 * to correct something that only really changes when you move your chair.
 *
 * Returns null when there is no camera, no model, or no face — every caller
 * treats that as "leave the framing alone".
 */
export async function detectFraming(
  stream: MediaStream | null | undefined,
): Promise<Framing | null> {
  const track = stream?.getVideoTracks()[0];
  if (!track) return null;

  const detector = await getDetector();
  if (!detector) return null;

  // A detached element, so this works whether or not the camera is on screen
  // and without disturbing playback of the one that is.
  const video = document.createElement("video");
  video.srcObject = new MediaStream([track]);
  video.muted = true;
  video.playsInline = true;

  try {
    await video.play();
    // One frame has to have arrived before there is anything to look at.
    if (!video.videoWidth) {
      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
        window.setTimeout(resolve, 1000);
      });
    }
    if (!video.videoWidth) return null;

    const canvas = document.createElement("canvas");
    const scale = SAMPLE_WIDTH / video.videoWidth;
    canvas.width = SAMPLE_WIDTH;
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    let best: { framing: Framing; area: number } | null = null;
    for (const d of detector.detect(canvas).detections) {
      const box = d.boundingBox;
      const score = d.categories?.[0]?.score ?? 1;
      if (!box || score < MIN_CONFIDENCE) continue;

      const area = box.width * box.height;
      // The largest face wins. With two people at one camera, following the
      // nearer one is at least a rule rather than a coin toss.
      if (!best || area > best.area) {
        best = {
          area,
          framing: {
            x: (box.originX + box.width / 2) / canvas.width,
            y: (box.originY + box.height / 2) / canvas.height,
          },
        };
      }
    }

    return best?.framing ?? null;
  } catch {
    return null;
  } finally {
    video.srcObject = null;
  }
}
