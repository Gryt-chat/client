import { useEffect, useRef } from "react";

import { freshUploadsFileUrl, getStoredWorn, getUploadsFileUrl, setStoredWorn, useUserId } from "@/common";
import { useSettings } from "@/settings";
import { useServerManagement, useSockets } from "@/socket";

import { mainIdentityChanges } from "../lib/mainIdentity";

const MIRRORED = "gryt.mainIdentityAvatar";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Keeps this device's profile in step with the first server in the sidebar, which new servers then get. Draws nothing. */
export function MainIdentity() {
  const { orderedServerHosts } = useServerManagement();
  const { serverProfiles } = useSockets();
  const { nickname, setNickname, setAvatarFile } = useSettings();
  const userId = useUserId();
  const host = orderedServerHosts[0] ?? null;
  const profile = host ? serverProfiles[host] : undefined;
  // The picture being fetched, since this runs on every render while it's on its way.
  const fetching = useRef<string | null>(null);

  useEffect(() => {
    if (!host || !profile) return;
    const change = mainIdentityChanges({ host, ...profile }, { nickname, worn: getStoredWorn(), mirroredAvatar: read(MIRRORED) });
    if (change.nickname) setNickname(change.nickname);
    if (change.worn !== undefined) setStoredWorn(change.worn);
    if (!change.avatar || change.avatar === fetching.current || !userId || !profile.avatarFileId) return;
    const key = change.avatar;
    fetching.current = key;
    void fetch(freshUploadsFileUrl(getUploadsFileUrl(host, profile.avatarFileId)))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then(async (blob) => {
        await setAvatarFile(new File([blob], "avatar", { type: blob.type }));
        localStorage.setItem(MIRRORED, key);
      })
      .catch((e) => console.warn("[MainIdentity] Could not copy the first server's picture:", e))
      .finally(() => (fetching.current = null));
  }, [host, profile, nickname, userId, setNickname, setAvatarFile]);

  return null;
}
