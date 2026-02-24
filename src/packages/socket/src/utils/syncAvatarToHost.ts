import { Dispatch, SetStateAction } from "react";
import { Socket } from "socket.io-client";

import { getAvatarHash, getServerHttpBase, getStoredAvatar, getUploadsFileUrl } from "@/common";

type ServerProfile = { nickname: string; avatarFileId: string | null; avatarUrl: string | null };

function extForMime(mime: string): string {
  switch ((mime || "").toLowerCase()) {
    case "image/gif": return "gif";
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    default: return "bin";
  }
}

async function uploadAvatarToServer(
  host: string,
  accessToken: string,
  blob: Blob,
): Promise<{ avatarFileId?: string }> {
  const form = new FormData();
  const ext = extForMime(blob.type || "");
  form.append("file", blob, `avatar.${ext}`);
  const base = getServerHttpBase(host);
  const r = await fetch(`${base}/api/uploads/avatar`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  let data: Record<string, unknown> = {};
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  if (!r.ok) {
    console.warn(`[Avatar] auto-sync upload failed for ${host}: ${r.status}`, data);
    return {};
  }
  return data as { avatarFileId?: string };
}

/**
 * Upload the locally stored avatar to a server if it hasn't been synced yet.
 * Compares hashes to avoid redundant uploads.
 */
export async function syncAvatarToHost(
  host: string,
  accessToken: string,
  currentAvatarFileId: string | null | undefined,
  socket: Socket,
  setServerProfiles: Dispatch<SetStateAction<Record<string, ServerProfile>>>,
): Promise<void> {
  const stored = await getStoredAvatar().catch(() => null);
  if (!stored?.blob) return;

  const localHash = await getAvatarHash(stored.blob);
  const lastUploadedHash = localStorage.getItem(`avatarHash:${host}`);
  if (currentAvatarFileId && localHash === lastUploadedHash) return;

  const result = await uploadAvatarToServer(host, accessToken, stored.blob);
  if (result.avatarFileId) {
    localStorage.setItem(`avatarFileId:${host}`, result.avatarFileId);
    localStorage.setItem(`avatarHash:${host}`, localHash);
    setServerProfiles(prev => ({
      ...prev,
      [host]: {
        ...prev[host],
        avatarFileId: result.avatarFileId!,
        avatarUrl: getUploadsFileUrl(host, result.avatarFileId!),
      },
    }));
    socket.emit("avatar:updated");
  }
}
