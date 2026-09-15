/** Shown when the server predates `/api/uploads/group-icon`. */
export const GROUP_PICTURE_NEEDS_UPDATE =
  "This server needs an update before groups can have their own picture.";

/** Never falls back to the avatar route, which made the picture your own avatar
    too (GRYT-1182). An older server gets no group picture instead. */
export async function uploadGroupPicture(
  base: string,
  accessToken: string,
  file: Blob,
  filename: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", file, filename);
  const response = await fetch(`${base}/api/uploads/group-icon`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (response.status === 404) throw new Error(GROUP_PICTURE_NEEDS_UPDATE);

  const data = (await response.json().catch(() => ({}))) as {
    fileId?: string;
    message?: string;
  };
  if (!response.ok || !data.fileId) {
    throw new Error(data.message || "The server would not take that picture");
  }
  return data.fileId;
}
