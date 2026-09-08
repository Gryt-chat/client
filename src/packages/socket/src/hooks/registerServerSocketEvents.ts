import { warmSfuSelection } from "@gryt/voice";
import { Dispatch, MutableRefObject, SetStateAction } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import { setAnnouncedPlugins } from "@/addons";
import {
  addMention,
  addThreadMention,
  getServerAccessToken,
  getServerRefreshToken,
  getStoredWorn,
  getUploadsFileUrl,
  rememberPlacements,
  removeServerAccessToken,
  removeServerFileToken,
  removeServerRefreshToken,
  setMentionCounts,
  setServerAccessToken,
  setServerFileToken,
  setServerNotice,
  setServerRefreshToken,
  setThreadMentionCounts,
} from "@/common";
import {
  evaluateMemberKeys,
  identityScopeFor,
  localPeerPinStore,
  type MemberKeyState,
  ownDmPublicKey,
  readSealedVault,
} from "@/common";
import {
  Server,
  serverDetails,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";

import { type DmKeyFix, showDmKeyWarning } from "../components/dmKeyWarningToast";
import { MemberInfo } from "../components/MemberSidebar";
import {
  applyCallMemberships,
  type CallMemberships,
  rememberCallMembers,
} from "../lib/callMembers";
import { Clients, ServerProfile } from "../types/clients";
import { publishDmKey } from "../utils/dmKeys";
import { fetchCustomEmojis, setCustomEmojis } from "../utils/emojiData";
import { firstTimeOnThisSocket } from "../utils/publishedOnce";
import { handleRateLimitError } from "../utils/rateLimitHandler";
import { syncAvatarToHost } from "../utils/syncAvatarToHost";

const TOKEN_HEAL_COOLDOWN_MS = 10_000;
const tokenHealLastAttempt = new Map<string, number>();

/** The member list identifies people by serverUserId but says nothing about
    which entry is you, so this is how the two are joined up. */
const myServerUserIdByHost = new Map<string, string>();

/** `server:joined` fires only from `server:verify`, which a client holding a
    token never reaches, so `server:details` is the signal both routes produce. */
const DM_KEY = "dm-key";

function canAttemptTokenHeal(host: string): boolean {
  const last = tokenHealLastAttempt.get(host) ?? 0;
  if (Date.now() - last < TOKEN_HEAL_COOLDOWN_MS) return false;
  tokenHealLastAttempt.set(host, Date.now());
  return true;
}

export interface ServerEventContext {
  nickname: string;
  userIdRef: MutableRefObject<string | null>;
  servers: Servers;
  serversRef: MutableRefObject<Servers>;
  lastInviteJoinAttemptRef: MutableRefObject<Record<string, string | undefined>>;
  myVoiceStateByHostRef: MutableRefObject<Record<string, { hasJoinedChannel: boolean; voiceChannelId: string }>>;
  setServers: (servers: Servers) => void;
  setNewServerInfo: Dispatch<SetStateAction<Server[]>>;
  setServerDetailsList: Dispatch<SetStateAction<serverDetailsList>>;
  setFailedServerDetails: Dispatch<SetStateAction<Record<string, { error: string; message: string; timestamp: number }>>>;
  setClients: Dispatch<SetStateAction<{ [host: string]: Clients }>>;
  setMemberLists: Dispatch<SetStateAction<{ [host: string]: MemberInfo[] }>>;
  /** What to do about each member's DM key here, by member id (GRYT-727). */
  setMemberKeyStates: Dispatch<
    SetStateAction<{ [host: string]: Record<string, MemberKeyState> }>
  >;
  setServerProfiles: Dispatch<SetStateAction<Record<string, ServerProfile>>>;
  setIsServerMuted: (value: boolean) => void;
  setIsServerDeafened: (value: boolean) => void;
}

/** Long enough for our publish and the member list after it to land, short
    enough that a genuine mismatch is not hidden. */
const DM_KEY_WARNING_DELAY_MS = 5000;

/** Pending warnings, per host, so a resolution can cancel one before it shows. */
const dmKeyWarningTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * A dismissal that holds.
 *
 * The warning is re-armed from every `members:list`, and one of those arrives
 * whenever anybody joins or leaves. Dismissing it therefore bought a few
 * seconds of quiet and no more, which is why it read as impossible to get rid
 * of. Cleared again the moment the mismatch stops, in the branch below.
 *
 * Per device rather than per account: the key it is about is this device's.
 */
const DM_KEY_DISMISSED_PREFIX = "gryt_dm_key_warning_dismissed:";

function dmKeyWarningDismissed(host: string): boolean {
  try {
    return localStorage.getItem(`${DM_KEY_DISMISSED_PREFIX}${host}`) === "1";
  } catch {
    // No storage. Showing it is the safe direction for a warning.
    return false;
  }
}

function rememberDmKeyWarningDismissed(host: string): void {
  try {
    localStorage.setItem(`${DM_KEY_DISMISSED_PREFIX}${host}`, "1");
  } catch {
    /* Then it comes back next launch, which is a nuisance and not a bug. */
  }
}

function forgetDmKeyWarningDismissed(host: string): void {
  try {
    localStorage.removeItem(`${DM_KEY_DISMISSED_PREFIX}${host}`);
  } catch {
    /* as above */
  }
}

/** What this device can do about a mismatch, asked of the account. */
async function dmKeyFix(): Promise<DmKeyFix> {
  try {
    return (await readSealedVault()) ? "unlock" : "set-up";
  } catch {
    // Not signed in, or the account would not answer. Neither button would
    // work, so neither is offered.
    return "none";
  }
}

export function registerServerSocketEvents(socket: Socket, host: string, ctx: ServerEventContext) {
  /** Remembered rather than applied once: the next `server:clients` arrives with
      the conversation id blanked again, so this is re-applied to each. */
  let callMemberships: CallMemberships = {};

  const { nickname, userIdRef, servers, serversRef, lastInviteJoinAttemptRef, myVoiceStateByHostRef } = ctx;
  const { setServers, setNewServerInfo, setServerDetailsList, setFailedServerDetails } = ctx;
  const { setClients, setMemberLists, setMemberKeyStates, setServerProfiles, setIsServerMuted, setIsServerDeafened } = ctx;

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

  /* One event name for both the question and the answer, so one handler covers
     both and two windows cannot disagree about what is left. */
  socket.on(
    "mentions:list",
    (payload: {
      counts?: Record<string, number>;
      mentions?: Array<{ conversation_id?: string; thread_id?: string | null }>;
    }) => {
      setMentionCounts(host, payload?.counts ?? {});
      /* Built from the rows rather than the counts beside them, which are keyed by
         thread alone and cannot say how much of a channel's count they hold. */
      setThreadMentionCounts(host, payload?.mentions ?? []);
    },
  );

  socket.on("mention:new", (payload: { conversationId?: string; threadId?: string | null }) => {
    if (!payload?.conversationId) return;
    addMention(host, payload.conversationId);
    if (payload.threadId) addThreadMention(host, payload.conversationId, payload.threadId);
  });

  socket.on("server:details", (data: serverDetails) => {
    /* Where the sidebar arrives, and the layer deciding whether a message makes a
       noise has no other way to know a channel's folder. Before the join check. */
    if (Array.isArray(data.sidebar_items)) {
      rememberPlacements(host, data.sidebar_items);
    }

    /* Replaced rather than merged, so a removed plugin stops being listed on the
       next details. A server too old to say sends nothing. */
    setAnnouncedPlugins(
      host,
      Array.isArray(data.server_info?.plugins)
        ? data.server_info.plugins
            .filter((p) => typeof p?.id === "string")
            .map((p) => ({
              id: p.id,
              /* A server that named it without a name is old rather than shy,
                 and the id is what it called itself. */
              name: typeof p.name === "string" ? p.name : p.id,
              author: typeof p.author === "string" ? p.author : undefined,
              description: typeof p.description === "string" ? p.description : undefined,
              /* Checked again on the way in: a link somebody clicks is not worth
                 taking on trust from a server they joined by accident. */
              homepage:
                typeof p.homepage === "string" && /^https?:\/\//i.test(p.homepage)
                  ? p.homepage
                  : undefined,
              capabilities: Array.isArray(p.capabilities)
                ? p.capabilities.filter((c): c is string => typeof c === "string")
                : [],
            }))
        : [],
    );

    if (data.error === "join_required") {
      const existingAccessToken = getServerAccessToken(host);
      if (existingAccessToken) {
        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          socket.emit("token:refresh", { refreshToken });
        } else {
          socket.emit("token:refresh", { accessToken: existingAccessToken });
        }
        return;
      }
      setTimeout(() => {
        socket.emit("server:join", {
          nickname,
          inviteCode: servers[host]?.token || undefined,
        });
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

    // Not awaited: a key that never arrives means no encrypted messages rather
    // than a connection that failed.
    if (firstTimeOnThisSocket(socket, DM_KEY)) void publishDmKey(socket, host);

    if (data.sfu_hosts?.length) {
      warmSfuSelection(host, data.sfu_hosts);
    }

    setFailedServerDetails(prev => {
      const updated = { ...prev };
      delete updated[host];
      return updated;
    });
  });

  socket.on("server:emojis:updated", () => {
    fetchCustomEmojis(host).then((list) => {
      // Null is a refused read, not an empty server: this fires once per emoji an
      // import stages, when the read is most likely rate-limited.
      if (list) setCustomEmojis(list, host);
    });
  });

  socket.on("server:joined", (joinInfo: { accessToken: string; fileToken?: string; refreshToken?: string; nickname: string; avatarFileId?: string | null; avatarWorn?: string | null }) => {
    setServerAccessToken(host, joinInfo.accessToken);
    // Before anything renders. Every avatar and every picture reaches for this,
    // so storing it late means a screen of broken images on the first join.
    if (joinInfo.fileToken) setServerFileToken(host, joinInfo.fileToken);

    // The earlier of the two publishes, so the key is on the server before the
    // first member list goes out and nobody sees them appear without one.
    if (firstTimeOnThisSocket(socket, DM_KEY)) void publishDmKey(socket, host);
    if (joinInfo.refreshToken) {
      setServerRefreshToken(host, joinInfo.refreshToken);
    }

    // Said out loud, because the request was made in a dialog that has long since
    // closed and grey going to normal is a change nobody is watching for.
    if (serversRef.current[host]?.approvalRequestedAt) {
      const rest = { ...serversRef.current[host] };
      delete rest.approvalRequestedAt;
      const updated = { ...serversRef.current, [host]: rest };
      serversRef.current = updated;
      setServers(updated);
      toast.success(`You were let in to ${rest.name || host}`, { duration: 8000 });
    }

    setServerProfiles(prev => ({
      ...prev,
      [host]: {
        nickname: joinInfo.nickname,
        avatarFileId: joinInfo.avatarFileId || null,
        avatarUrl: joinInfo.avatarFileId
          ? getUploadsFileUrl(host, joinInfo.avatarFileId)
          : null,
        // Undefined from a server older than the field, which reads as no
        // designed look — and that is what such a server has.
        avatarWorn: joinInfo.avatarWorn ?? null,
      },
    }));

    // Only when the server has none: the look is per-server once set, and
    // `server:joined` fires on reconnects, so pushing would undo that choice.
    const storedWorn = getStoredWorn();
    if (storedWorn && !joinInfo.avatarWorn) {
      socket.emit("profile:update", { avatarWorn: storedWorn });
    }

    socket.emit("server:details");
    socket.emit("members:fetch");
    // Every join, not just the first: being away is when this accumulates, and it
    // is how a mention read on a phone stops showing here.
    socket.emit("mentions:list");

    // Read when the event fires, not at registration: the socket exists before
    // `useUserId` resolves, so a captured value was usually null.
    const userId = userIdRef.current;
    if (joinInfo.accessToken && userId) {
      syncAvatarToHost(host, joinInfo.accessToken, joinInfo.avatarFileId, socket, setServerProfiles, userId)
        .catch(() => {});
    }
  });

  socket.on("profile:updated", (data: { nickname: string; avatarFileId: string | null; avatarWorn?: string | null }) => {
    setServerProfiles(prev => ({
      ...prev,
      [host]: {
        nickname: data.nickname,
        avatarFileId: data.avatarFileId,
        avatarUrl: data.avatarFileId
          ? getUploadsFileUrl(host, data.avatarFileId)
          : null,
        // Optional on the wire, since an older server does not send it. Undefined
        // reads as no designed look, and the uploaded PNG shows instead.
        avatarWorn: data.avatarWorn ?? null,
      },
    }));
  });

  socket.on(
    "server:setup_required",
    (payload: {
      serverId?: string;
      settings?: {
        displayName?: string;
        description?: string;
        iconUrl?: string | null;
        isConfigured?: boolean;
      };
    }) => {
      // A reconnect must not reopen setup for a configured server. Kept as
      // protection against older server versions.
      if (payload?.settings?.isConfigured === true) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent("server_setup_required", {
          detail: {
            host,
            ...(payload || {}),
          },
        })
      );
    }
  );

  /* A kind plus values, never text; everything on screen ships in
     `ServerNoticePanel`. Re-checked here, because that is somebody else's machine. */
  socket.on("server:notice", (payload: unknown) => {
    setServerNotice(host, payload);
  });

  socket.on("server:kicked", (data: { reason?: string; action?: "kick" | "ban" }) => {
    const serverName = serversRef.current[host]?.name || host;
    toast.error(data?.reason ? `${serverName}: ${data.reason}` : `You were removed from ${serverName}.`);

    // Both, not just the access token: keeping the refresh token let a kicked
    // client mint a new one and walk straight back in.
    removeServerAccessToken(host);
    removeServerFileToken(host);
    removeServerRefreshToken(host);

    window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
      detail: { host, reason: data?.action === "ban" ? "banned_from_server" : "kicked_from_server" },
    }));

    // A kick is not permanent and rejoining still works, but leaving a server you
    // were removed from in the sidebar is worse than adding it back.
    window.dispatchEvent(new CustomEvent("server_force_remove", { detail: { host } }));
  });

  socket.on("server:session:replaced", (data: { message?: string }) => {
    toast(data?.message || "You signed in from another device or tab.", {
      icon: "🔄",
      duration: 8000,
    });
    removeServerAccessToken(host);
    removeServerRefreshToken(host);
    window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
      detail: { host, reason: "session_replaced" },
    }));
  });

  socket.on("server:error", (errorInfo: { error: string; message?: string; retryAfterMs?: number; currentScore?: number; maxScore?: number; canReapply?: boolean }) => {
    console.error(`Server join failed for ${host}:`, errorInfo);

    if (errorInfo.error === 'rate_limited' && errorInfo.message) {
      handleRateLimitError(errorInfo, "Server connection");
      return;
    }

    if (errorInfo.error === "join_required") {
      setTimeout(() => {
        socket.emit("server:join", {
          nickname,
          inviteCode: serversRef.current[host]?.token || undefined,
        });
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

    if (errorInfo.error === "invite_rate_limited") {
      const message = errorInfo.message || "Too many incorrect invite attempts. Please wait.";
      toast.error(message, { duration: 6000 });
      return;
    }

    // Not an error toast: nothing went wrong and there is nothing to retry. A
    // denial reads the same, because the server will not say which it is.
    if (errorInfo.error === "approval_pending") {
      const message =
        errorInfo.message || "This server admits people by request. Yours is with the moderators.";
      toast(message, { duration: 8000, icon: "🖐" });
      return;
    }

    if (errorInfo.error === "invite_required") {
      const message = errorInfo.message || "This server is invite-only.";
      toast.error(message, { duration: 6000 });
      toast(`Open an invite link to join ${host}.`, { duration: 8000 });
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

    // Passed straight through: the generic branch calls everything a join
    // failure, and somebody leaving is already in.
    if (
      errorInfo.error === "owner_cannot_leave" ||
      errorInfo.error === "leave_failed" ||
      errorInfo.error === "not_registered"
    ) {
      toast.error(errorInfo.message || "Could not leave this server.", { duration: 8000 });
      return;
    }

    // Not join problems: the generic branch renders every one of these as
    // "Failed to join server <host>: forbidden", which is wrong in both halves.
    const MODERATION_ERRORS = [
      "forbidden",
      "not_found",
      "kick_failed",
      "ban_failed",
      "unban_failed",
      "mute_failed",
      "deafen_failed",
      "bans_failed",
    ];
    if (MODERATION_ERRORS.includes(errorInfo.error)) {
      toast.error(errorInfo.message || "That action was refused.");
      return;
    }

    // Recorded like the refusals below, or the panel sits on a skeleton blaming
    // the network. Tokens are left alone: the identity was rejected, not them.
    if (errorInfo.error === "identity_tier_refused") {
      const message =
        errorInfo.message || "This server requires a Gryt account to join.";
      toast.error(message, { duration: 6000 });

      setFailedServerDetails((prev) => ({
        ...prev,
        [host]: {
          error: errorInfo.error,
          message,
          timestamp: Date.now(),
        },
      }));
      return;
    }

    // The server will not say why, so the client cannot tell a ban from any other
    // refusal and must not guess: no force-remove, which is not recoverable.
    if (
      errorInfo.error === 'join_refused' ||
      errorInfo.error === 'banned' ||
      errorInfo.error === 'membership_required'
    ) {
      removeServerAccessToken(host);
      removeServerRefreshToken(host);
      toast.error(errorInfo.message || `Sorry, you can't join ${host}.`);

      // Recording it here is what stops the retry loops asking again every few
      // seconds; without it the refusal repeats for as long as the app is open.
      setFailedServerDetails((prev) => ({
        ...prev,
        [host]: {
          error: errorInfo.error,
          message: errorInfo.message || "Sorry, you can't join this server.",
          timestamp: Date.now(),
        },
      }));
      return;
    }

    if (errorInfo.error === 'token_invalid') {
      removeServerAccessToken(host);

      if (!canAttemptTokenHeal(host)) return;

      const refreshToken = getServerRefreshToken(host);
      if (refreshToken) {
        socket.emit("token:refresh", { refreshToken });
      } else {
        removeServerRefreshToken(host);
        socket.emit("server:join", {
          nickname,
          inviteCode: serversRef.current[host]?.token || undefined,
        });
      }
      return;
    } else {
      toast.error(`Failed to join server ${host}: ${errorInfo.error}`);
    }
  });

  /** Sent into that call's own room and nowhere else, so receiving it is the
      proof of being allowed to know. */
  socket.on(
    "voice:call:members",
    (payload: { conversation_id?: string; server_user_ids?: string[] }) => {
      if (!payload?.conversation_id || !Array.isArray(payload.server_user_ids)) return;
      callMemberships = rememberCallMembers(
        callMemberships,
        payload.conversation_id,
        payload.server_user_ids,
      );
      setClients((old) => {
        const patched = applyCallMemberships(old[host] ?? {}, callMemberships);
        if (patched === old[host]) return old;
        return { ...old, [host]: patched };
      });
    },
  );

  socket.on("server:clients", (data: Clients) => {
    setClients((old) => {
      const prev = old[host] ?? {};
      for (const [cid, client] of Object.entries(data)) {
        const prevClient = prev[cid];
        if (
          client.screenShareEnabled !== prevClient?.screenShareEnabled ||
          client.screenShareVideoStreamID !== prevClient?.screenShareVideoStreamID
        ) {
          console.log(
            `[ScreenShare] server:clients update cid=${cid} nick=${client.nickname} screenEnabled=${client.screenShareEnabled} videoStreamID=${client.screenShareVideoStreamID ?? ""}` +
            ` (was enabled=${prevClient?.screenShareEnabled} streamID=${prevClient?.screenShareVideoStreamID ?? ""})`,
          );
        }
      }
      return { ...old, [host]: applyCallMemberships(data, callMemberships) };
    });

    const myEntry = socket.id ? data[socket.id] : undefined;
    myVoiceStateByHostRef.current[host] = {
      hasJoinedChannel: !!myEntry?.hasJoinedChannel,
      voiceChannelId: myEntry?.voiceChannelId || "",
    };
    if (myEntry) {
      setIsServerMuted(!!myEntry.isServerMuted);
      setIsServerDeafened(!!myEntry.isServerDeafened);
      if (myEntry.serverUserId) {
        myServerUserIdByHost.set(host, myEntry.serverUserId);
      }
    }
  });

  socket.on("members:list", (data: MemberInfo[]) => {
    const membersWithGrayColor = data.map(member => ({
      ...member,
      color: "var(--gryt-neutral-6)"
    }));
    setMemberLists((old) => ({ ...old, [host]: membersWithGrayColor }));

    // Separate from the list above, so a slow evaluation never holds up the
    // sidebar: a key decision changes what can be encrypted, not who is online.
    const myId = myServerUserIdByHost.get(host) ?? null;
    void (myId ? ownDmPublicKey(host).catch(() => null) : Promise.resolve(null))
      .then((ownKey) =>
        evaluateMemberKeys({
          store: localPeerPinStore,
          scope: identityScopeFor(host),
          ownKey,
          members: data,
          myServerUserId: myId,
        }),
      )
      .then((states) => {
        setMemberKeyStates((old) => ({ ...old, [host]: states }));

        /* Held back before it is shown, since our own publish races the first
           member list and every join flashed it. A second device really does
           mismatch, which is why the wording names that first. */
        const myId = myServerUserIdByHost.get(host);
        const toastId = `dm-key-rewritten-${host}`;
        const pending = dmKeyWarningTimers.get(host);

        if (myId && states[myId]?.ownKeyRewritten) {
          if (pending === undefined && !dmKeyWarningDismissed(host)) {
            dmKeyWarningTimers.set(
              host,
              setTimeout(() => {
                dmKeyWarningTimers.delete(host);
                /* Which repair to offer depends on the account, so it is asked
                   here rather than guessed: a sealed copy means this device can
                   take it, and no sealed copy means there is nothing for a
                   second device to take yet. A guest, or a request that fails,
                   gets the warning with no button rather than one that leads
                   somewhere useless. */
                void dmKeyFix().then((fix) => {
                  if (dmKeyWarningDismissed(host)) return;
                  showDmKeyWarning({
                    id: toastId,
                    serverName: serversRef.current[host]?.name || host,
                    fix,
                    onDismiss: () => rememberDmKeyWarningDismissed(host),
                  });
                });
              }, DM_KEY_WARNING_DELAY_MS),
            );
          }
        } else {
          if (pending !== undefined) {
            clearTimeout(pending);
            dmKeyWarningTimers.delete(host);
          }
          /* The mismatch is gone, so an earlier dismissal has done its job. If
             it ever comes back it is news again, and should say so. */
          forgetDmKeyWarningDismissed(host);
          toast.dismiss(toastId);
        }
      })
      .catch(() => {
        // Storage that will not read, most likely. Leaving the previous states
        // alone is right: dropping them would make every peer look new.
      });

    // Written on a plain join, not only on a change: Settings fell back to the
    // local nickname under a caption saying it was what others see.
    const myServerUserId = myServerUserIdByHost.get(host);
    if (!myServerUserId) return;

    const me = data.find((member) => member.serverUserId === myServerUserId);
    if (!me) return;

    setServerProfiles((prev) => {
      const existing = prev[host];
      if (
        existing?.nickname === me.nickname &&
        existing?.avatarFileId === (me.avatarFileId ?? null) &&
        existing?.avatarWorn === (me.avatarWorn ?? null)
      ) {
        return prev;
      }

      return {
        ...prev,
        [host]: {
          nickname: me.nickname,
          avatarFileId: me.avatarFileId ?? null,
          avatarUrl: me.avatarFileId
            ? getUploadsFileUrl(host, me.avatarFileId)
            : null,
          avatarWorn: me.avatarWorn ?? null,
        },
      };
    });
  });

  socket.on("error", (msg: unknown) => {
    const text = typeof msg === "string" ? msg : ((msg as Record<string, unknown>)?.message || "Unknown socket error");
    toast.error(`[${host}] ${text}`);
  });
}
