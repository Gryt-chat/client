import { getServerAccessToken, getServerHttpBase } from "@/common";

import type { ImageDimensions } from "../utils/imageUtils";

export async function uploadChatFile(
  file: File,
  serverHost: string,
  dimensions?: ImageDimensions | null,
): Promise<string> {
  const accessToken = getServerAccessToken(serverHost);
  if (!accessToken) throw new Error("Not authenticated with this server");
  const base = getServerHttpBase(serverHost);
  const form = new FormData();
  form.append("file", file);
  if (dimensions) {
    form.append("width", String(dimensions.width));
    form.append("height", String(dimensions.height));
  }
  const resp = await fetch(`${base}/api/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!resp.ok) {
    const raw = await resp.text().catch(() => "");
    let msg = `Upload failed (${resp.status})`;
    try {
      const err = raw ? JSON.parse(raw) : {};
      if (err.message) msg = err.message;
      else if (err.error) msg = err.error;
    } catch { /* ignored */ }
    console.error("[Upload] Failed:", { status: resp.status, url: `${base}/api/uploads`, body: raw });
    throw new Error(msg);
  }
  const data = await resp.json();
  return data.fileId as string;
}
