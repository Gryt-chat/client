import { createElement, Dispatch, MutableRefObject, SetStateAction, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import type { MemberKeyState } from "@/common";
import {
  answerChallenge,
  getPlacement,
  getServerRefreshToken,
  isSessionExpired,
  isSignedOut,
  markChannelUnread,
  markSignedOut,
  markThreadUnread,
  removeServerAccessToken,
  removeServerRefreshToken,
  resolveAnnounceLevel,
  setServerAccessToken,
  setServerFileToken,
  shouldAnnounceMessage,
} from "@/common";
import { showDesktopNotification } from "@/lib/desktopNotification";
import { playNotificationSound, preloadNotificationSound } from "@/lib/notificationSound";
import {
  Server,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";

import { PiMicrophoneFill, PiMicrophoneSlashFill, PiSpeakerHighFill, PiSpeakerSlashFill } from "../../../../lib/icons";
import { MemberInfo } from "../components/MemberSidebar";
import { Clients, ServerProfile } from "../types/clients";
import { challengeHostMatches } from "../utils/challengeHost";
import { sealedNotificationBody } from "../utils/sealedNotification";
import { idleRecovery, planRecovery, type RecoveryState } from "../utils/sessionRecovery";
import { registerServerSocketEvents } from "./registerServerSocketEvents";

type Sockets = { [host: string]: Socket };


/** The server sends the whole enriched message; this names what the file uses,
    rather than casting at the call site. */
type BackgroundMessage = {
  sender_server_id: string;
  conversation_id?: string;
  sender_nickname?: string;
  text?: string | null;
  sealed?: string | null;
  attachments?: string[] | null;
  /* The server always sent this; the type never named it, so a thread reply and
     a channel message were badged the same. */
  thread_id?: string | null;
};

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
  desktopNotificationsEnabled: boolean;
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
  // Refs rather than state: the handlers below are registered once per host, so
  // anything they read has to survive renders without moving.
  const revokedRecoveryRef = useRef<Record<string, RecoveryState>>({});
  const revokedTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    desktopNotificationsEnabled,
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
  const desktopNotificationsEnabledRef = useRef(desktopNotificationsEnabled);
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
  useEffect(() => { desktopNotificationsEnabledRef.current = desktopNotificationsEnabled; }, [desktopNotificationsEnabled]);
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

      // Nothing listened, so every moderation action was fire-and-forget. Quiet
      // and short, since the member list is what shows the result.
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
          icon: createElement(data.muted ? PiMicrophoneSlashFill : PiMicrophoneFill, { size: 18 }),
        });
      });

      socket.on("server:deafened", (data: { deafened: boolean }) => {
        setIsServerDeafened(data.deafened);
        toast(data.deafened ? "You have been server deafened by an admin." : "Your server deafen has been removed.", {
          icon: createElement(data.deafened ? PiSpeakerSlashFill : PiSpeakerHighFill, { size: 18 }),
        });
      });

      // ---- Challenge-response identity authentication ----

      socket.on("server:challenge", async (challenge: { nonce: string; serverHost: string }) => {
        // Bound to this host: signing whatever the other end names lets a server
        // we did not dial collect an assertion valid elsewhere.
        if (!challengeHostMatches(host, challenge.serverHost)) {
          console.error(
            `[Auth:Socket] Refusing to sign for ${host}: challenge claims to be ` +
              `"${challenge.serverHost}"`
          );
          return;
        }

        // Here rather than at each caller, since a dozen places emit
        // `server:join`. The keypair is still on disk, so answering signs them in.
        if (isSignedOut(host)) {
          console.log(`[Auth:Socket] Not answering for ${host}: signed out on this device`);
          setFailedServerDetails(prev => ({
            ...prev,
            [host]: {
              error: "session_ended",
              message: "You signed this device out. Sign in again to use this server here.",
              timestamp: Date.now(),
            },
          }));
          return;
        }

        try {
          const { certificate, assertion, tier, link } = await answerChallenge(host, challenge);
          console.log(`[Auth:Socket] Answering as ${tier} identity`);
          socket.emit("server:verify", { certificate, assertion, link });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[Auth:Socket] Failed to answer challenge for ${host}:`, msg);

          // Not answering ends the join and the server never asks again, which the
          // UI renders as a skeleton only a reload gets out of.
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

      // Back to full, or a server rotating its counter twice in an afternoon eats
      // retries that never come back. Handled elsewhere too, which is fine.
      const recoveryWorked = () => { delete revokedRecoveryRef.current[host]; };
      socket.on("server:joined", recoveryWorked);

      socket.on("token:refreshed", (refreshInfo: { accessToken: string; fileToken?: string }) => {
        recoveryWorked();
        setServerAccessToken(host, refreshInfo.accessToken);
        // With the access token: a file token lasts hours, so a session that keeps
        // refreshing never reaches the point where pictures fail.
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

        const pending = revokedTimersRef.current[host];
        if (pending) {
          clearTimeout(pending);
          delete revokedTimersRef.current[host];
        }

        const { plan, state } = planRecovery(
          revokedRecoveryRef.current[host] ?? idleRecovery(),
          info?.reason,
          Date.now(),
        );
        revokedRecoveryRef.current[host] = state;

        if (plan.act === "stop") {
          // `failedServerDetails` is what stops `refreshIfStuck` rejoining on the
          // next window focus, not only what shows the user something.
          removeServerRefreshToken(host);

          if (plan.because === "deliberate") {
            // Written down, or the refusal lives only in memory and the next launch
            // rejoins with the keypair as if nothing happened.
            markSignedOut(host);
            toast.error(info?.message || `Your session on ${host} was ended.`);
            setFailedServerDetails(prev => ({
              ...prev,
              [host]: {
                error: "session_ended",
                message: "Sign in again to reconnect to this server.",
                timestamp: Date.now(),
              },
            }));
            return;
          }

          const givenUp = `Stopped reconnecting to ${host}. It keeps ending your session.`;
          toast.error(givenUp);
          setFailedServerDetails(prev => ({
            ...prev,
            [host]: { error: "revocation_loop", message: givenUp, timestamp: Date.now() },
          }));
          return;
        }

        // Once, on the first try: the message is about a session being replaced,
        // and five toasts saying so is worse than none.
        if (plan.retry === 1 && info?.message) toast.error(info.message);

        const refreshToken = getServerRefreshToken(host);
        revokedTimersRef.current[host] = setTimeout(() => {
          delete revokedTimersRef.current[host];
          if (refreshToken) {
            socket.emit("token:refresh", { refreshToken });
          } else {
            socket.emit("server:join", { nickname, inviteCode: servers[host]?.token || undefined });
          }
        }, plan.delayMs);
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

        // What the refresh token cannot fix: retrying with it is an infinite loop
        // of sending the same dead token back.
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

      socket.on("chat:new", (msg: BackgroundMessage) => {
        if (host === currentlyViewingServerRef.current?.host) return;
        const myId = socket.id ? clientsRef.current[host]?.[socket.id]?.serverUserId : undefined;
        if (myId && msg.sender_server_id === myId) return;
        // Counted against the thread rather than dropped: both trackers were keyed
        // by conversation, and this one is keyed by thread.
        if (msg.thread_id) {
          /* Returns either way: a thread reply never counts against the channel,
             and one with no conversation id cannot be placed. */
          if (msg.conversation_id) markThreadUnread(host, msg.conversation_id, msg.thread_id);
          return;
        }

        /* Unread whatever the level says: muting is about not being interrupted,
           not about pretending nothing happened. */
        if (msg.conversation_id) {
          markChannelUnread(host, msg.conversation_id);
        }

        const level = resolveAnnounceLevel(
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
        if (desktopNotificationsEnabledRef.current) {
          void sealedNotificationBody(msg, { host, memberId: myId }).then((body) =>
            showDesktopNotification(msg.sender_nickname || "New message", body),
          );
        }
      });

      /* A second listener on an event `registerServerSocketEvents` also handles:
         that one keeps the count, this one decides whether to make a noise. */
      socket.on("mention:new", (payload: { conversationId?: string }) => {
        if (host === currentlyViewingServerRef.current?.host) return;

        const level = resolveAnnounceLevel(
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
