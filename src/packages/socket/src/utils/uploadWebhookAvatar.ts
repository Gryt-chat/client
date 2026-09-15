/** The attachment route, which leaves your own avatar alone. It has always
    answered `fileId`; reading `file_id` meant the avatar never saved. */
export async function uploadWebhookAvatar(
  base: string,
  headers: Record<string, string>,
  file: Blob,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);
  const response = await fetch(`${base}/api/uploads`, { method: "POST", headers, body: form });

  const data = (await response.json().catch(() => ({}))) as {
    fileId?: string;
    message?: string;
  };
  if (!response.ok || !data.fileId) {
    throw new Error(data.message || "Failed to upload avatar");
  }
  return data.fileId;
}
