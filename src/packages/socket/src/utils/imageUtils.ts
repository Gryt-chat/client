export interface ImageDimensions {
  width: number;
  height: number;
}

/** A video's metadata can sit at the end of the file; past this the upload goes without a size. */
const VIDEO_METADATA_TIMEOUT_MS = 5000;

/** The picture's size as the browser draws it, so a rotated phone video comes back portrait. */
export function getMediaDimensions(file: File): Promise<ImageDimensions | null> {
  if (file.type.startsWith("image/")) return getImageDimensions(file);
  if (file.type.startsWith("video/")) return getVideoDimensions(file);
  return Promise.resolve(null);
}

function getImageDimensions(file: File): Promise<ImageDimensions | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

function getVideoDimensions(file: File): Promise<ImageDimensions | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (dims: ImageDimensions | null) => {
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    const timer = setTimeout(() => done(null), VIDEO_METADATA_TIMEOUT_MS);
    video.onloadedmetadata = () =>
      done(video.videoWidth && video.videoHeight ? { width: video.videoWidth, height: video.videoHeight } : null);
    video.onerror = () => done(null);
    video.muted = true;
    video.preload = "metadata";
    video.src = url;
  });
}
