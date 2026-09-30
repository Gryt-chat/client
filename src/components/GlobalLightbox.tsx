import { closeLightbox, useLightboxImage } from "../lib/lightboxStore";
import { ImageLightbox } from "../packages/socket/src/components/ImageLightbox";

/** Mounted once at the top of the app, above anything that might close while a picture is open. */
export function GlobalLightbox() {
  const image = useLightboxImage();
  if (!image) return null;
  return <ImageLightbox src={image.src} alt={image.alt} onClose={closeLightbox} />;
}
