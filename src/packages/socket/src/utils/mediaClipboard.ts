function convertToPng(blob: Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Image load failed"));
    };
    img.src = URL.createObjectURL(blob);
  });
}

/** `source` is a URL to fetch, or the image itself when the client already holds it. */
export async function copyImageToClipboard(source: string | Blob) {
  // Not from the cache: the <img> left an entry without CORS headers there, and this fetch fails on it.
  const blob = typeof source === "string" ? await (await fetch(source, { cache: "no-store" })).blob() : source;
  const pngBlob = blob.type === "image/png"
    ? blob
    : await convertToPng(blob);
  await navigator.clipboard.write([
    new ClipboardItem({ "image/png": pngBlob }),
  ]);
}
