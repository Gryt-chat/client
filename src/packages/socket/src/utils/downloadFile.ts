import toast from "react-hot-toast";

/** Hands `blob` to the browser's download under `fileName`, then frees the URL made for it. */
export function saveBlob(blob: Blob, fileName?: string | null): void {
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = fileName || "";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(blobUrl);
}

/** The file behind a blob URL this page made, with the type it was made with. */
export async function readBlobUrl(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/**
 * Saves a file the client already holds, or can decrypt. When `open` fails there is no fallback
 * to the server copy, which for an encrypted file is ciphertext.
 */
export async function saveOpenedFile(
  open: () => Promise<Blob>,
  fileName?: string | null,
): Promise<void> {
  let blob: Blob;
  try {
    blob = await open();
  } catch {
    toast.error("Couldn't save the file");
    return;
  }
  saveBlob(blob, fileName);
}

/**
 * Download a file without triggering page navigation: a cross-origin download
 * link fires `beforeunload` and tears down the WebSocket and WebRTC connections.
 */
export async function triggerDownload(
  url: string,
  fileName?: string | null,
): Promise<void> {
  // Already in this page. A query string breaks a blob URL, and opening one in a tab saves nothing.
  if (url.startsWith("blob:")) return saveOpenedFile(() => readBlobUrl(url), fileName);

  const downloadUrl = url.includes("?") ? `${url}&download=1` : `${url}?download=1`;

  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    saveBlob(await res.blob(), fileName);
  } catch {
    window.open(downloadUrl, "_blank", "noopener,noreferrer");
  }
}
