import { Dispatch, MutableRefObject, SetStateAction, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import type { MemberKeyState } from "@/common";
import {
  answerChallenge,
  getPlacement,
  getPrefsSnapshot,
  getServerRefreshToken,
  isSessionExpired,
  markChannelUnread,
  removeServerAccessToken,
  removeServerRefreshToken,
  resolveLevel,
  setServerAccessToken,
  setServerFileToken,
  shouldAnnounceMessage,
} from "@/common";
import { playNotificationSound, preloadNotificationSound } from "@/lib/notificationSound";
import {
  Server,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";

import { MemberInfo } from "../components/MemberSidebar";
import { Clients, ServerProfile } from "../types/clients";
import { challengeHostMatches } from "../utils/challengeHost";
import { registerServerSocketEvents } from "./registerServerSocketEvents";

type Sockets = { [host: string]: Socket };

export interface SocketEventDeps {
  servers: Servers;
  nickname: string;
  userIdRef: MutableRefObject<string | null>;
  connectSoundEnabled: boolean;
  disconnectSoundEnabled: boolean;
  connectSoundFile: string;
  disconnectSoundFile: string;
  connectSoundVolume: number;
  disconnectSoundVolume: number;
  messageSoundEnabled: boolean;
  messageSoundVolume: number;
  messageSoundFile: string;
  notificationBadgeEnabled: boolean;
  incrementUnread: () => void;
  currentlyViewingServerRef: MutableRefObject<{ host: string; name: string } | null>;
  clientsRef: MutableRefObject<{ [host: string]: Clients }>;
  serversRef: MutableRefObject<Servers>;
  lastInviteJoinAttemptRef: MutableRefObject<Record<string, string | undefined>>;
  setServers: (servers: Servers) => void;
  setNewServerInfo: Dispatch<SetStateAction<Server[]>>;
  setServerDetailsList: Dispatch<SetStateAction<serverDetailsList>>;
  setFailedServerDetails: Dispatch<SetStateAction<Record<string, { error: string; message: string; timestamp: number }>>>;
  setClients: Dispatch<SetStateAction<{ [host: string]: Clients }>>;
  setMemberLists: Dispatch<SetStateAction<{ [host: string]: MemberInfo[] }>>;
  setMemberKeyStates: Dispatch<
    SetStateAction<{ [host: string]: Record<string, MemberKeyState> }>
  >;
  setServerProfiles: Dispatch<SetStateAction<Record<string, ServerProfile>>>;
  setIsServerMuted: (value: boolean) => void;
  setIsServerDeafened: (value: boolean) => void;
  onTokenRefreshed: () => void;
}

export function useSocketEvents(sockets: Sockets, deps: SocketEventDeps) {
  const registeredRef = useRef<Set<string>>(new Set());
  const myVoiceStateByHostRef = useRef<Record<string, { hasJoinedChannel: boolean; voiceChannelId: string }>>({});

  const {
    servers,
    nickname,
    userIdRef,
    connectSoundEnabled,
    disconnectSoundEnabled,
    connectSoundFile,
    disconnectSoundFile,
    connectSoundVolume,
    disconnectSoundVolume,
    messageSoundEnabled,
    messageSoundVolume,
    messageSoundFile,
    notificationBadgeEnabled,
    incrementUnread,
    currentlyViewingServerRef,
    clientsRef,
    serversRef,
    lastInviteJoinAttemptRef,
    setServers,
    setNewServerInfo,
    setServerDetailsList,
    setFailedServerDetails,
    setClients,
    setMemberLists,
    setMemberKeyStates,
    setServerProfiles,
    setIsServerMuted,
    setIsServerDeafened,
    onTokenRefreshed,
  } = deps;

  const connectSoundEnabledRef = useRef(connectSoundEnabled);
  const disconnectSoundEnabledRef = useRef(disconnectSoundEnabled);
  const connectSoundFileRef = useRef(connectSoundFile);
  const disconnectSoundFileRef = useRef(disconnectSoundFile);
  const connectSoundVolumeRef = useRef(connectSoundVolume);
  const disconnectSoundVolumeRef = useRef(disconnectSoundVolume);
  const messageSoundEnabledRef = useRef(messageSoundEnabled);
  const messageSoundVolumeRef = useRef(messageSoundVolume);
  const messageSoundFileRef = useRef(messageSoundFile);
  const notificationBadgeEnabledRef = useRef(notificationBadgeEnabled);
  const incrementUnreadRef = useRef(incrementUnread);
  const onTokenRefreshedRef = useRef(onTokenRefreshed);

  useEffect(() => { connectSoundEnabledRef.current = connectSoundEnabled; }, [connectSoundEnabled]);
  useEffect(() => { disconnectSoundEnabledRef.current = disconnectSoundEnabled; }, [disconnectSoundEnabled]);
  useEffect(() => { connectSoundFileRef.current = connectSoundFile; preloadNotificationSound(connectSoundFile); }, [connectSoundFile]);
  useEffect(() => { disconnectSoundFileRef.current = disconnectSoundFile; preloadNotificationSound(disconnectSoundFile); }, [disconnectSoundFile]);
  useEffect(() => { connectSoundVolumeRef.current = connectSoundVolume; }, [connectSoundVolume]);
  useEffect(() => { disconnectSoundVolumeRef.current = disconnectSoundVolume; }, [disconnectSoundVolume]);
  useEffect(() => { messageSoundEnabledRef.current = messageSoundEnabled; }, [messageSoundEnabled]);
  useEffect(() => { messageSoundVolumeRef.current = messageSoundVolume; }, [messageSoundVolume]);
  useEffect(() => { messageSoundFileRef.current = messageSoundFile; preloadNotificationSound(messageSoundFile); }, [messageSoundFile]);
  useEffect(() => { notificationBadgeEnabledRef.current = notificationBadgeEnabled; }, [notificationBadgeEnabled]);
  useEffect(() => { incrementUnreadRef.current = incrementUnread; }, [incrementUnread]);
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

      // The server has always emitted these and nothing has ever listened, so
      // every moderation action was fire-and-forget: no confirmation, no error,
      // nothing to tell a moderator whether the thing they just did happened.
      //
      // The member list is what actually shows the result, so these stay quiet
      // and short rather than narrating what is already visible.
      type ModerationResult = { muted?: boolean; deafened?: boolean };
      const moderationResult = (event: string, message: (p: ModerationResult) => string) => {
        socket.on(event, (payload: ModerationResult) => toast.success(message(payload ?? {})));
      };

      moderationResult("server:kick:success", () => "Kicked.");
      moderationResult("server:ban:success", () => "Banned.");
      moderationResult("server:unban:success", () => "Unbanned.");
      moderationResult("server:mute:success", (p) => (p.muted ? "Server muted." : "Server mute removed."));
      moderationResult("server:deafen:success", (p) => (p.deafened ? "Server deafened." : "Server deafen removed."));

      socket.on("server:muted", (data: { muted: boolean }) => {
        setIsServerMuted(data.muted);
        toast(data.muted ? "You have been server muted by an admin." : "Your server mute has been removed.", {
          icon: data.muted ? "🔇" : "🔊",
        });
      });

      socket.on("server:deafened", (data: { deafened: boolean }) => {
        setIsServerDeafened(data.deafened);
        toast(data.deafened ? "You have been server deafened by an admin." : "Your server deafen has been removed.", {
          icon: data.deafened ? "🔇" : "🔊",
        });
      });

      // ---- Challenge-response identity authentication ----

      socket.on("server:challenge", async (challenge: { nonce: string; serverHost: string }) => {
        // The assertion is bound to this host. Signing whatever the other end
        // names would let a server we did not dial collect an assertion valid
        // somewhere else.
        if (!challengeHostMatches(host, challenge.serverHost)) {
          console.error(
            `[Auth:Socket] Refusing to sign for ${host}: challenge claims to be ` +
              `"${challenge.serverHost}"`
          );
          return;
        }

        try {
          const { certificate, assertion, tier, link } = await answerChallenge(host, challenge);
          console.log(`[Auth:Socket] Answering as ${tier} identity`);
          socket.emit("server:verify", { certificate, assertion, link });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[Auth:Socket] Failed to answer challenge for ${host}:`, msg);

          // Not answering ends the join, and the server has no reason to ask
          // again — so this has to be said out loud. Logging it and returning
          // left the socket connected with no data behind it, which the UI
          // renders as a skeleton that never resolves, and only a reload got
          // out of it (GRYT-10).
          setFailedServerDetails(prev => ({
            ...prev,
            [host]: isSessionExpired(e)
              ? {
                  error: "session_expired",
                  // The card's heading already says the session expired, so
                  // this says what to do about it rather than repeating it.
                  message: "Sign in again to reconnect to this server.",
                  timestamp: Date.now(),
                }
              : {
                  error: "identity_failed",
                  message: `Could not prove who you are to this server: ${msg}`,
                  timestamp: Date.now(),
                },
          }));
        }
      });

      // ---- Token lifecycle ----

      socket.on("token:refreshed", (refreshInfo: { accessToken: string; fileToken?: string }) => {
        setServerAccessToken(host, refreshInfo.accessToken);
        // Re-stored with the access token. A file token lasts hours rather than
        // minutes, so a session that keeps refreshing never reaches the point
        // where its pictures start failing.
        if (refreshInfo.fileToken) setServerFileToken(host, refreshInfo.fileToken);
        onTokenRefreshedRef.current();

        setServerDetailsList(prev => {
          if (!prev[host]) {
            socket.emit("server:details");
            socket.emit("members:fetch");
          }
          return prev;
        });
      });

      socket.on("token:revoked", (info: { reason?: string; message?: string }) => {
        removeServerAccessToken(host);

        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          socket.emit("token:refresh", { refreshToken });
        } else {
          if (info?.message) toast.error(info.message);
          setTimeout(() => {
            socket.emit("server:join", { nickname, inviteCode: servers[host]?.token || undefined });
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

        // Errors the refresh token cannot fix. Retrying with it was an
        // infinite loop: the server says the token is dead, we send the same
        // dead token back, forever. It went unnoticed because only a leave on
        // another device or an identity replace could revoke a token — until a
        // kick started doing it, which is how a kick is made to stick.
        const TERMINAL = [
          "refresh_token_invalid",
          "refresh_token_expired",
          "membership_required",
          "banned",
        ];

        if (TERMINAL.includes(errorInfo.error)) {
          removeServerRefreshToken(host);
          toast.error(errorInfo.message || `Signed out of ${host}.`);
          return;
        }

        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          console.log(`[Auth:Socket] token:error for ${host} — attempting refresh with refresh token`);
          socket.emit("token:refresh", { refreshToken });
        } else {
          removeServerRefreshToken(host);
          const msg = errorInfo.message || errorInfo.error;
          toast.error(`Auth failed for ${host}: ${msg}`);
        }
      });

      // ---- Peer join/leave sound notifications ----

      socket.on("voice:peer:joined", (payload: { clientId: string; nickname: string; channelId?: string }) => {
        if (!connectSoundEnabledRef.current) return;
        if (!payload?.channelId) return;
        if (payload.clientId === socket.id) return;
        const mine = myVoiceStateByHostRef.current[host];
        if (mine && (!mine.hasJoinedChannel || payload.channelId !== mine.voiceChannelId)) return;
        playNotificationSound(connectSoundFileRef.current, connectSoundVolumeRef.current);
      });

      socket.on("voice:peer:left", (payload: { clientId: string; nickname: string; channelId?: string }) => {
        if (!disconnectSoundEnabledRef.current) return;
        if (!payload?.channelId) return;
        if (payload.clientId === socket.id) return;
        const mine = myVoiceStateByHostRef.current[host];
        if (mine && (!mine.hasJoinedChannel || payload.channelId !== mine.voiceChannelId)) return;
        playNotificationSound(disconnectSoundFileRef.current, disconnectSoundVolumeRef.current);
      });

      // ---- Background chat notification (non-focused servers) ----

      socket.on("chat:new", (msg: { sender_server_id: string; conversation_id?: string }) => {
        if (host === currentlyViewingServerRef.current?.host) return;
        const myId = socket.id ? clientsRef.current[host]?.[socket.id]?.serverUserId : undefined;
        if (myId && msg.sender_server_id === myId) return;

        /* Marked unread whatever the level says. Muting a channel is about not
           being interrupted, not about pretending nothing happened there. The
           dot is how somebody finds it later, on their own terms. */
        if (msg.conversation_id) {
          markChannelUnread(host, msg.conversation_id);
        }

        const level = resolveLevel(
          getPrefsSnapshot(),
          host,
          msg.conversation_id ? getPlacement(host, msg.conversation_id) : null,
        );
        if (!shouldAnnounceMessage(level)) return;

        if (messageSoundEnabledRef.current) {
          playNotificationSound(messageSoundFileRef.current, messageSoundVolumeRef.current);
        }
        if (notificationBadgeEnabledRef.current) {
          incrementUnreadRef.current();
        }
      });

      /*
       * Being named, which is what makes "mentions only" a level rather than a
       * quieter way of saying none.
       *
       * A second listener on an event `registerServerSocketEvents` also handles.
       * socket.io calls both, and they answer different questions: that one
       * keeps the count, this one decides whether to make a noise.
       *
       * Silent at "all", because `chat:new` has already fired for the same
       * message and two sounds for one arrival is worse than none.
       */
      socket.on("mention:new", (payload: { conversationId?: string }) => {
        if (host === currentlyViewingServerRef.current?.host) return;

        const level = resolveLevel(
          getPrefsSnapshot(),
          host,
          payload?.conversationId ? getPlacement(host, payload.conversationId) : null,
        );
        if (level !== "mentions") return;

        if (messageSoundEnabledRef.current) {
          playNotificationSound(messageSoundFileRef.current, messageSoundVolumeRef.current);
        }
        if (notificationBadgeEnabledRef.current) {
          incrementUnreadRef.current();
        }
      });

      // ---- Server management events (delegated) ----

      registerServerSocketEvents(socket, host, {
        nickname,
        userIdRef,
        servers,
        serversRef,
        lastInviteJoinAttemptRef,
        myVoiceStateByHostRef,
        setServers,
        setNewServerInfo,
        setServerDetailsList,
        setFailedServerDetails,
        setClients,
        setMemberLists,
        setMemberKeyStates,
        setServerProfiles,
        setIsServerMuted,
        setIsServerDeafened,
      });
    });

    for (const host of registeredRef.current) {
      if (!sockets[host]) {
        registeredRef.current.delete(host);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sockets]);
}
