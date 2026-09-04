/**
 * Download a file without triggering page navigation.
 *
 * fetch + blob URL, so the browser never starts navigating away — a
 * cross-origin download link fires `beforeunload` and tears down the WebSocket
 * and WebRTC connections. Falls back to a new tab if the fetch fails.
 */
export async function triggerDownload(
  url: string,
  fileName?: string | null,
): Promise<void> {
  const downloadUrl = url.includes("?") ? `${url}&download=1` : `${url}?download=1`;

  try {
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName || "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(downloadUrl, "_blank", "noopener,noreferrer");
  }
}
