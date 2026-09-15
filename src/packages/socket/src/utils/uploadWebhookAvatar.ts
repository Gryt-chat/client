/** Shown when the server predates `/api/uploads/webhook-avatar`. */
export const WEBHOOK_AVATAR_NEEDS_UPDATE =
  "This server needs an update before you can change a webhook's avatar.";

/** Resized like any avatar, and your own is left alone. Never falls back to the
    attachment route, which stored the picture at full size (GRYT-1185). */
export async function uploadWebhookAvatar(
  base: string,
  headers: Record<string, string>,
  file: Blob,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);
  const response = await fetch(`${base}/api/uploads/webhook-avatar`, { method: "POST", headers, body: form });
  if (response.status === 404) throw new Error(WEBHOOK_AVATAR_NEEDS_UPDATE);

  const data = (await response.json().catch(() => ({}))) as {
    fileId?: string;
    message?: string;
  };
  if (!response.ok || !data.fileId) {
    throw new Error(data.message || "Failed to upload avatar");
  }
  return data.fileId;
}
