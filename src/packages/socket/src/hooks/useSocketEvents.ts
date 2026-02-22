import { Dispatch, MutableRefObject, SetStateAction,useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import {
  getAvatarHash,
  getServerAccessToken,
  getServerHttpBase,
  getServerRefreshToken,
  getStoredAvatar,
  getUploadsFileUrl,
  getValidIdentityToken,
  removeServerAccessToken,
  removeServerRefreshToken,
  setServerAccessToken,
  setServerRefreshToken,
} from "@/common";
import {
  Server,
  serverDetails,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";
import { warmSfuSelection } from "@/webRTC/src/hooks/selectBestSfuUrl";

import { MemberInfo } from "../components/MemberSidebar";
import { Clients } from "../types/clients";
import { handleRateLimitError } from "../utils/rateLimitHandler";

type Sockets = { [host: string]: Socket };

function extForMime(mime: string): string {
  switch ((mime || "").toLowerCase()) {
    case "image/gif": return "gif";
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/webp": return "webp";
    default: return "bin";
  }
}

async function uploadAvatarToServer(host: string, accessToken: string, blob: Blob): Promise<{ avatarFileId?: string }> {
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

const TOKEN_HEAL_COOLDOWN_MS = 10_000;
const tokenHealLastAttempt = new Map<string, number>();

function canAttemptTokenHeal(host: string): boolean {
  const last = tokenHealLastAttempt.get(host) ?? 0;
  if (Date.now() - last < TOKEN_HEAL_COOLDOWN_MS) return false;
  tokenHealLastAttempt.set(host, Date.now());
  return true;
}

export interface SocketEventDeps {
  servers: Servers;
  nickname: string;
  connectSoundEnabled: boolean;
  disconnectSoundEnabled: boolean;
  connectSoundFile: string;
  disconnectSoundFile: string;
  connectSoundVolume: number;
  disconnectSoundVolume: number;
  serversRef: MutableRefObject<Servers>;
  lastInviteJoinAttemptRef: MutableRefObject<Record<string, string | undefined>>;
  setServers: (servers: Servers) => void;
  setNewServerInfo: Dispatch<SetStateAction<Server[]>>;
  setServerDetailsList: Dispatch<SetStateAction<serverDetailsList>>;
  setFailedServerDetails: Dispatch<SetStateAction<Record<string, { error: string; message: string; timestamp: number }>>>;
  setClients: Dispatch<SetStateAction<{ [host: string]: Clients }>>;
  setMemberLists: Dispatch<SetStateAction<{ [host: string]: MemberInfo[] }>>;
  setServerProfiles: Dispatch<SetStateAction<Record<string, { nickname: string; avatarFileId: string | null; avatarUrl: string | null }>>>;
  onTokenRefreshed: () => void;
}

/**
 * Registers all socket event listeners (server:info, server:details,
 * server:clients, server:joined, token:*, voice:*, etc.) on every socket
 * in the map.  Handlers are registered exactly once per host and are never
 * torn down (mirrors the original behaviour where listeners live for the
 * lifetime of the socket).
 */
export function useSocketEvents(sockets: Sockets, deps: SocketEventDeps) {
  const registeredRef = useRef<Set<string>>(new Set());

  const {
    servers,
    nickname,
    connectSoundEnabled,
    disconnectSoundEnabled,
    connectSoundFile,
    disconnectSoundFile,
    connectSoundVolume,
    disconnectSoundVolume,
    serversRef,
    lastInviteJoinAttemptRef,
    setServers,
    setNewServerInfo,
    setServerDetailsList,
    setFailedServerDetails,
    setClients,
    setMemberLists,
    setServerProfiles,
    onTokenRefreshed,
  } = deps;

  const connectSoundEnabledRef = useRef(connectSoundEnabled);
  const disconnectSoundEnabledRef = useRef(disconnectSoundEnabled);
  const connectSoundFileRef = useRef(connectSoundFile);
  const disconnectSoundFileRef = useRef(disconnectSoundFile);
  const connectSoundVolumeRef = useRef(connectSoundVolume);
  const disconnectSoundVolumeRef = useRef(disconnectSoundVolume);
  const onTokenRefreshedRef = useRef(onTokenRefreshed);

  useEffect(() => { connectSoundEnabledRef.current = connectSoundEnabled; }, [connectSoundEnabled]);
  useEffect(() => { disconnectSoundEnabledRef.current = disconnectSoundEnabled; }, [disconnectSoundEnabled]);
  useEffect(() => { connectSoundFileRef.current = connectSoundFile; }, [connectSoundFile]);
  useEffect(() => { disconnectSoundFileRef.current = disconnectSoundFile; }, [disconnectSoundFile]);
  useEffect(() => { connectSoundVolumeRef.current = connectSoundVolume; }, [connectSoundVolume]);
  useEffect(() => { disconnectSoundVolumeRef.current = disconnectSoundVolume; }, [disconnectSoundVolume]);
  useEffect(() => { onTokenRefreshedRef.current = onTokenRefreshed; }, [onTokenRefreshed]);

  useEffect(() => {
    Object.entries(sockets).forEach(([host, socket]) => {
      if (registeredRef.current.has(host)) return;
      registeredRef.current.add(host);

      // ---- Voice / stream events ----

      socket.on("voice:error", (error: { type: string; message: string; existingConnection?: unknown }) => {
        if (error.type === "duplicate_connection") {
          toast.error(error.message);
          window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
            detail: { host, reason: "duplicate_connection" },
          }));
        }
      });

      socket.on("voice:device:disconnect", (data: { type: string; message: string; newDevice?: unknown }) => {
        if (data.type === "device_switch") {
          window.dispatchEvent(new CustomEvent("voice:device:disconnect", {
            detail: { message: data.message, newDevice: data.newDevice },
          }));
        }
      });

      socket.on("voice:channel:joined", (hasJoined: boolean) => {
        if (!hasJoined) {
          window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
            detail: { host, reason: "server_initiated" },
          }));
        }
      });

      socket.on("voice:stream:set", (streamID: string) => {
        if (!streamID) {
          window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
            detail: { host, reason: "stream_cleared" },
          }));
        }
      });

      socket.on("voice:room:leave", () => {
        window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
          detail: { host, reason: "room_leave" },
        }));
      });

      socket.on("voice:kicked", (data: { reason?: string }) => {
        toast.error(data?.reason || "You were disconnected from voice by an admin.");
        window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
          detail: { host, reason: "kicked" },
        }));
      });

      socket.on("server:kicked", (data: { reason?: string }) => {
        toast.error(data?.reason || "You were kicked from the server.");
        removeServerAccessToken(host);
        window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
          detail: { host, reason: "kicked_from_server" },
        }));
      });

      socket.on("server:muted", (data: { muted: boolean }) => {
        toast(data.muted ? "You have been server muted by an admin." : "Your server mute has been removed.", {
          icon: data.muted ? "🔇" : "🔊",
        });
      });

      socket.on("server:deafened", (data: { deafened: boolean }) => {
        toast(data.deafened ? "You have been server deafened by an admin." : "Your server deafen has been removed.", {
          icon: data.deafened ? "🔇" : "🔊",
        });
      });

      // ---- Server info / details ----

      socket.on("server:info", (data: { name?: string }) => {
        const current = serversRef.current[host];
        const updatedServer = {
          ...current,
          host,
          name: data.name || current?.name || host,
        };

        if (current && current.name === updatedServer.name) return;

        setNewServerInfo((old) => {
          if (old.some(server => server.host === updatedServer.host)) return old;
          return [...old, updatedServer];
        });
      });

      socket.on("server:details", (data: serverDetails) => {
        if (data.error === "join_required") {
          const existingAccessToken = getServerAccessToken(host);
          if (existingAccessToken) {
            const refreshToken = getServerRefreshToken(host);
            if (refreshToken) {
              (async () => {
                const identityToken = await getValidIdentityToken().catch(() => undefined);
                if (identityToken) {
                  socket.emit("token:refresh", { refreshToken, identityToken });
                } else {
                  socket.emit("token:refresh", { accessToken: existingAccessToken });
                }
              })();
            } else {
              socket.emit("token:refresh", { accessToken: existingAccessToken });
            }
            return;
          }
          setTimeout(() => {
            (async () => {
              const identityToken = await getValidIdentityToken().catch(() => undefined);
              socket.emit("server:join", {
                password: "",
                nickname,
                identityToken,
                inviteCode: servers[host]?.token || undefined,
              });
            })();
          }, 500);
          return;
        }

        if (data.error && data.message) {
          console.error(`Server details denied for ${host}:`, data.error, data.message);

          setFailedServerDetails(prev => ({
            ...prev,
            [host]: {
              error: data.error || 'unknown_error',
              message: data.message || 'Unknown error occurred',
              timestamp: Date.now()
            }
          }));

          if (data.error === 'rate_limited') {
            handleRateLimitError({ error: data.error, message: data.message }, "Server details");
          } else {
            toast.error(`Access denied: ${data.message}`);
          }
          return;
        }

        setServerDetailsList((old) => ({ ...old, [host]: data }));

        if (data.sfu_hosts?.length) {
          warmSfuSelection(host, data.sfu_hosts);
        }

        setFailedServerDetails(prev => {
          const updated = { ...prev };
          delete updated[host];
          return updated;
        });
      });

      // ---- Join / setup ----

      socket.on("server:joined", (joinInfo: { accessToken: string; refreshToken?: string; nickname: string; avatarFileId?: string | null }) => {
        setServerAccessToken(host, joinInfo.accessToken);
        if (joinInfo.refreshToken) {
          setServerRefreshToken(host, joinInfo.refreshToken);
        }

        setServerProfiles(prev => ({
          ...prev,
          [host]: {
            nickname: joinInfo.nickname,
            avatarFileId: joinInfo.avatarFileId || null,
            avatarUrl: joinInfo.avatarFileId
              ? getUploadsFileUrl(host, joinInfo.avatarFileId)
              : null,
          },
        }));

        socket.emit("server:details");
        socket.emit("members:fetch");

        if (joinInfo.accessToken) {
          Promise.resolve()
            .then(async () => {
              const stored = await getStoredAvatar().catch(() => null);
              if (!stored?.blob) return;

              const localHash = await getAvatarHash(stored.blob);
              const lastUploadedHash = localStorage.getItem(`avatarHash:${host}`);
              if (joinInfo.avatarFileId && localHash === lastUploadedHash) return;

              const result = await uploadAvatarToServer(host, joinInfo.accessToken, stored.blob);
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
            })
            .catch(() => {});
        }
      });

      socket.on("profile:updated", (data: { nickname: string; avatarFileId: string | null }) => {
        setServerProfiles(prev => ({
          ...prev,
          [host]: {
            nickname: data.nickname,
            avatarFileId: data.avatarFileId,
            avatarUrl: data.avatarFileId
              ? getUploadsFileUrl(host, data.avatarFileId)
              : null,
          },
        }));
      });

      socket.on("server:setup_required", (payload: Record<string, unknown>) => {
        window.dispatchEvent(new CustomEvent("server_setup_required", {
          detail: { host, ...(payload || {}) }
        }));
      });

      // ---- Token lifecycle ----

      socket.on("token:refreshed", (refreshInfo: { accessToken: string }) => {
        setServerAccessToken(host, refreshInfo.accessToken);
        onTokenRefreshedRef.current();

        setServerDetailsList(prev => {
          if (!prev[host]) {
            socket.emit("server:details");
            socket.emit("members:fetch");
          }
          return prev;
        });
      });

      socket.on("token:revoked", (info: { reason?: string; message?: string; requiresPassword?: boolean }) => {
        removeServerAccessToken(host);

        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          (async () => {
            const identityToken = await getValidIdentityToken().catch(() => undefined);
            if (identityToken) {
              socket.emit("token:refresh", { refreshToken, identityToken });
            } else {
              removeServerRefreshToken(host);
              if (info?.message) toast.error(info.message);
              socket.emit("server:join", { password: "", nickname, identityToken: undefined, inviteCode: servers[host]?.token || undefined });
            }
          })();
        } else {
          if (info?.message) toast.error(info.message);
          setTimeout(() => {
            (async () => {
              const identityToken = await getValidIdentityToken().catch(() => undefined);
              socket.emit("server:join", { password: "", nickname, identityToken, inviteCode: servers[host]?.token || undefined });
            })();
          }, 300);
        }
      });

      socket.on("token:invalid", (message: string) => {
        removeServerAccessToken(host);
        removeServerRefreshToken(host);
        toast.error(`Session expired: ${message}`);
        setTimeout(() => window.location.reload(), 2000);
      });

      socket.on("token:error", (errorInfo: { error: string; message?: string }) => {
        console.error(`Token error for server ${host}:`, errorInfo);
        removeServerAccessToken(host);

        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          (async () => {
            const identityToken = await getValidIdentityToken().catch(() => undefined);
            if (identityToken) {
              console.log(`[Auth:Socket] token:error for ${host} — attempting refresh with refresh token`);
              socket.emit("token:refresh", { refreshToken, identityToken });
            } else {
              removeServerRefreshToken(host);
              const msg = errorInfo.message || errorInfo.error;
              toast.error(`Auth failed for ${host}: ${msg}`);
            }
          })();
        } else {
          removeServerRefreshToken(host);
          const msg = errorInfo.message || errorInfo.error;
          toast.error(`Auth failed for ${host}: ${msg}`);
        }
      });

      // ---- Server errors ----

      socket.on("server:error", (errorInfo: { error: string; message?: string; retryAfterMs?: number; currentScore?: number; maxScore?: number; canReapply?: boolean }) => {
        console.error(`Server join failed for ${host}:`, errorInfo);

        if (errorInfo.error === 'rate_limited' && errorInfo.message) {
          handleRateLimitError(errorInfo, "Server connection");
          return;
        }

        if (errorInfo.error === "join_required") {
          setTimeout(() => {
            (async () => {
              const identityToken = await getValidIdentityToken().catch(() => undefined);
              socket.emit("server:join", {
                password: "",
                nickname,
                identityToken,
                inviteCode: serversRef.current[host]?.token || undefined,
              });
            })();
          }, 500);
          return;
        }

        if (errorInfo.error === 'invalid_invite') {
          const message = errorInfo.message || 'Invalid invite code.';
          toast.error(message, { duration: 6000 });

          const currentServers = serversRef.current;
          const existing = currentServers[host];
          if (existing?.token) {
            const nextServers = { ...currentServers, [host]: { ...existing, token: undefined } };
            setServers(nextServers);
            lastInviteJoinAttemptRef.current[host] = undefined;
          }

          toast(`Open a fresh invite link to re-join ${host}.`, { duration: 8000 });
          return;
        }

        if (errorInfo.error === 'invalid_password') {
          const message = errorInfo.message || 'Invalid server password.';
          toast.error(message, { duration: 6000 });
          window.dispatchEvent(new CustomEvent('server_password_required', {
            detail: { host, message, reason: "invalid_password" }
          }));
          return;
        }

        if (errorInfo.error === 'password_rate_limited') {
          const message = errorInfo.message || 'Too many incorrect password attempts.';
          toast.error(message, { duration: 6000 });
          window.dispatchEvent(new CustomEvent('server_password_required', {
            detail: {
              host,
              message,
              reason: "password_rate_limited",
              retryAfterMs: typeof errorInfo.retryAfterMs === "number" ? errorInfo.retryAfterMs : undefined,
            }
          }));
          return;
        }

        if (errorInfo.error === 'password_required') {
          const message = errorInfo.message || 'This server requires a password to join.';
          toast.error(message, { duration: 6000 });
          window.dispatchEvent(new CustomEvent('server_password_required', {
            detail: { host, message, reason: "password_required" }
          }));
          return;
        }

        if (errorInfo.error === 'user_not_authorized' || errorInfo.error === 'join_token_invalid' || errorInfo.error === 'join_verification_failed') {
          const message = errorInfo.message || 'You are not authorized to join this server.';
          toast.error(message, { duration: 6000 });
          setTimeout(() => {
            if (errorInfo.canReapply) {
              toast(
                `You can re-apply to join this server or remove it from your list. Check the server settings for more options.`,
                { duration: 8000, icon: 'ℹ️' }
              );
            } else {
              toast(
                `You can remove this server from your list if you no longer need access.`,
                { duration: 6000, icon: 'ℹ️' }
              );
            }
          }, 2000);
          return;
        }

        if (errorInfo.error === 'token_invalid') {
          removeServerAccessToken(host);

          if (!canAttemptTokenHeal(host)) return;

          (async () => {
            const refreshToken = getServerRefreshToken(host);
            const identityToken = await getValidIdentityToken().catch(() => undefined);

            if (refreshToken && identityToken) {
              socket.emit("token:refresh", { refreshToken, identityToken });
            } else {
              removeServerRefreshToken(host);
              socket.emit("server:join", {
                password: "",
                nickname,
                identityToken,
                inviteCode: serversRef.current[host]?.token || undefined,
              });
            }
          })();
          return;
        } else {
          toast.error(`Failed to join server ${host}: ${errorInfo.error}`);
        }
      });

      // ---- Client / member lists ----

      socket.on("server:clients", (data: Clients) => {
        setClients((old) => ({ ...old, [host]: data }));
      });

      socket.on("members:list", (data: MemberInfo[]) => {
        const membersWithGrayColor = data.map(member => ({
          ...member,
          color: "var(--gray-6)"
        }));
        setMemberLists((old) => ({ ...old, [host]: membersWithGrayColor }));
      });

      // ---- Peer join/leave sound notifications ----

      socket.on("voice:peer:joined", () => {
        if (!connectSoundEnabledRef.current) return;
        try {
          const audio = new Audio(connectSoundFileRef.current);
          audio.volume = Math.max(0, Math.min(1, connectSoundVolumeRef.current / 100));
          audio.play().catch(() => {});
        } catch (error) {
          console.error("Error playing peer join sound:", error);
        }
      });

      socket.on("voice:peer:left", () => {
        if (!disconnectSoundEnabledRef.current) return;
        try {
          const audio = new Audio(disconnectSoundFileRef.current);
          audio.volume = Math.max(0, Math.min(1, disconnectSoundVolumeRef.current / 100));
          audio.play().catch(() => {});
        } catch (error) {
          console.error("Error playing peer leave sound:", error);
        }
      });

      // ---- Generic errors ----

      socket.on("error", (msg: unknown) => {
        const text = typeof msg === "string" ? msg : ((msg as Record<string, unknown>)?.message || "Unknown socket error");
        toast.error(`[${host}] ${text}`);
      });
    });

    // Prune hosts whose sockets were removed
    for (const host of registeredRef.current) {
      if (!sockets[host]) {
        registeredRef.current.delete(host);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sockets]);
}
