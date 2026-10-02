export async function waitForMedia(url: string, timeoutMs = 90_000): Promise<void> {
  if (!url) throw new Error("Cannot check media processing on this server");
  const deadline = Date.now() + timeoutMs;
  do {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (response.ok) return;
    if (response.status !== 503) throw new Error("Server rejected the upload during media checks");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } while (Date.now() < deadline);
  throw new Error("Upload is still waiting for this server's image worker. Try again later.");
}
