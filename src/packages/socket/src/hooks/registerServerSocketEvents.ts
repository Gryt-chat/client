import { warmSfuSelection } from "@gryt/voice";
import { Dispatch, MutableRefObject, SetStateAction } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import { setAnnouncedPlugins } from "@/addons";
import {
  addMention,
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
} from "@/common";
import {
  evaluateMemberKeys,
  identityScopeFor,
  localPeerPinStore,
  type MemberKeyState,
  ownDmPublicKey,
} from "@/common";
import {
  Server,
  serverDetails,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";

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

/**
 * Our own serverUserId per host, learned from `clients:update`.
 *
 * The member list identifies people by serverUserId and carries the nickname
 * the server actually holds, but nothing in it says which entry is you. This is
 * how the two are joined up.
 */
const myServerUserIdByHost = new Map<string, string>();

/**
 * What `firstTimeOnThisSocket` is asked about below (GRYT-758). `server:joined`
 * fires only from `server:verify`, which a client holding a token never
 * reaches — so keyed on that, every existing member published no DM key and
 * encrypted DMs were on for new members only, with nothing erroring.
 * `server:details` is the one signal both routes produce.
 */
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

/**
 * How long a key mismatch has to persist before it is worth telling somebody.
 *
 * Long enough that our own publish, and the member list the server broadcasts
 * after it, have both landed. Short enough that a genuine mismatch is not
 * hidden for any length of time.
 */
const DM_KEY_WARNING_DELAY_MS = 5000;

/** Pending warnings, per host, so a resolution can cancel one before it shows. */
const dmKeyWarningTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function registerServerSocketEvents(socket: Socket, host: string, ctx: ServerEventContext) {
  /**
   * Who is in each call on this server, as last heard.
   *
   * Held here rather than in state because nothing renders it directly. It has
   * to be remembered rather than applied once: the next `server:clients`
   * arrives with the conversation id blanked out again, so this is re-applied
   * on every one of them.
   */
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

  /*
   * Where you have been named and have not read it.
   *
   * The server answers the whole list rather than a count, and on the same
   * event name for both the question and a "these are read now" — so this one
   * handler covers both, and two windows belonging to the same person cannot
   * disagree about what is left.
   */
  socket.on("mentions:list", (payload: { counts?: Record<string, number> }) => {
    setMentionCounts(host, payload?.counts ?? {});
  });

  socket.on("mention:new", (payload: { conversationId?: string }) => {
    if (payload?.conversationId) addMention(host, payload.conversationId);
  });

  socket.on("server:details", (data: serverDetails) => {
    /* Recorded here because this is where the sidebar arrives, and the socket
       layer that decides whether a message makes a noise has no other way to
       know which folder a channel is in. Before the join check below, since the
       placement is worth having even on a payload this handler goes on to bail
       out of, and it costs a map of ids. */
    if (Array.isArray(data.sidebar_items)) {
      rememberPlacements(host, data.sidebar_items);
    }

    /* Which plugins this server admits to running, for a client plugin deciding
       whether its other half is here (GRYT-939). Replaced rather than merged,
       so a plugin the operator removed stops being announced on the next
       details. Read defensively because an older server sends nothing. */
    setAnnouncedPlugins(
      host,
      Array.isArray(data.server_info?.plugins)
        ? data.server_info.plugins.filter(
            (p): p is { id: string; version: string } =>
              typeof p?.id === "string" && typeof p?.version === "string",
          )
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

    // Say what key to encrypt to us here (GRYT-727, GRYT-758). Not awaited:
    // nothing else depends on it, and a key that never arrives means no
    // encrypted messages rather than a connection that failed.
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
      // Null is a refused read rather than an empty server. This event fires
      // once per emoji an import stages, which is exactly the moment the read
      // is most likely to be rate-limited.
      if (list) setCustomEmojis(list, host);
    });
  });

  socket.on("server:joined", (joinInfo: { accessToken: string; fileToken?: string; refreshToken?: string; nickname: string; avatarFileId?: string | null; avatarWorn?: string | null }) => {
    setServerAccessToken(host, joinInfo.accessToken);
    // Before anything renders. Every avatar and every picture reaches for this,
    // so storing it late means a screen of broken images on the first join.
    if (joinInfo.fileToken) setServerFileToken(host, joinInfo.fileToken);

    // Say what key to encrypt to us here (GRYT-727). Not awaited: nothing else
    // in this handler depends on it, and a key that never arrives means no
    // encrypted messages rather than a join that failed.
    //
    // Kept alongside the `server:details` publish rather than replaced by it.
    // This one is the earlier of the two — the key is on the server before the
    // first member list goes out, so nobody sees the new member appear without.
    if (firstTimeOnThisSocket(socket, DM_KEY)) void publishDmKey(socket, host);
    if (joinInfo.refreshToken) {
      setServerRefreshToken(host, joinInfo.refreshToken);
    }

    // Somebody let them in (GRYT-289). The wait is the only thing this clears,
    // and it is worth saying out loud: the request was made minutes or days
    // ago, in a dialog that has long since closed, so an entry quietly going
    // from grey to normal is a change nobody is watching for.
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

    // Seed a server that has never heard of this account's look.
    //
    // Only when this device has one and the server has none. The look is
    // per-server once it is set, so pushing it on every reconnect would undo a
    // per-server choice every time the socket dropped. `server:joined` fires on
    // reconnects too, which is why the condition is about what the server
    // already holds rather than about this being a first join.
    const storedWorn = getStoredWorn();
    if (storedWorn && !joinInfo.avatarWorn) {
      socket.emit("profile:update", { avatarWorn: storedWorn });
    }

    socket.emit("server:details");
    socket.emit("members:fetch");
    // What was said to you while you were away. Asked on every join rather than
    // only the first, because being away is exactly when it accumulates — and
    // because it is also how a mention read on a phone stops showing here.
    socket.emit("mentions:list");

    // **Read when the event fires, not when the handler was registered.** The
    // socket is created as soon as Keycloak initialises, while `useUserId` is
    // still resolving in an effect — so a captured value was usually null, the
    // sync was skipped, and `server:joined` never fires twice. For the owner it
    // is a certainty rather than a race (GRYT-12).
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
        // Optional on the wire, because a server older than the field does not
        // send it. Undefined there reads as null here — no designed look — and
        // the uploaded PNG the editor saved is what shows instead, which is
        // exactly what that server has.
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
      // Reconnect/startup should not reopen setup for an already configured
      // server. Keep this guard even if the server is fixed as protection against
      // older server versions.
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

  /* Something the server needs this one person to see (GRYT-896).

     The payload is a kind plus values — never text. Everything that reaches the
     screen ships in `ServerNoticePanel`. `setServerNotice` re-checks the shape
     rather than trusting it: the server validating its own output guards
     against a bug in the server, and this guards against the server, which is
     somebody else's machine. */
  socket.on("server:notice", (payload: unknown) => {
    setServerNotice(host, payload);
  });

  socket.on("server:kicked", (data: { reason?: string; action?: "kick" | "ban" }) => {
    const serverName = serversRef.current[host]?.name || host;
    toast.error(data?.reason ? `${serverName}: ${data.reason}` : `You were removed from ${serverName}.`);

    // Both, not just the access token. Keeping the refresh token is what let a
    // kicked client mint a new access token and walk straight back in — the
    // handler immediately below this one has always removed both.
    removeServerAccessToken(host);
    removeServerFileToken(host);
    removeServerRefreshToken(host);

    window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
      detail: { host, reason: data?.action === "ban" ? "banned_from_server" : "kicked_from_server" },
    }));

    // Take it out of the sidebar. A kick is not permanent — rejoining by
    // address, LAN discovery or a still-valid invite all still work — but
    // leaving a server there that you have been removed from is worse than
    // making you add it back.
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

    // Waiting on a person, not a code. Deliberately not an error toast: nothing
    // went wrong and there is nothing to retry — the answer arrives when a
    // moderator gets to it, and the message says so. A denial is reported the
    // same way, because the server refuses to say which of the two it is.
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

    // A refusal, not a failure. It used to fall through to the generic branch
    // below and read "Failed to join server <host>: banned" — repeatedly, since
    // the retry loops keep re-emitting server:join. Clear the tokens so those
    // loops have nothing left to try with.
    // Moderation refusals and failures. These are not join problems, and the
    // generic branch below renders every one of them as
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

    // Refused for what this identity is rather than who it is. The server
    // explains this one and already says so in `server:info`, so the message
    // passes straight through.
    //
    // **Recorded like the refusals below, because that is what ends the
    // attempt.** On the generic branch the connection never reached a terminal
    // state and the panel sat on the skeleton, blaming network conditions for a
    // "no" that arrived immediately.
    //
    // **Tokens are deliberately left alone.** What was rejected is the identity
    // in hand, not anything stored for this server.
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

    // The server will not say why, on purpose — a refusal does not confirm
    // whether a ban exists or whether this identity is even known there. So the
    // client cannot tell a ban from any other refusal, and must not guess:
    // no force-remove, because a refusal may be temporary and deleting
    // somebody's server entry is not recoverable.
    //
    // `banned` is still handled for servers that predate the generic refusal.
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

  /**
   * The people in a call, which the server tells only the call.
   *
   * Sent into that call's own socket.io room and nowhere else, so receiving it
   * is the proof of being allowed to know. See `lib/callMembers.ts` for why the
   * id is missing in the first place.
   */
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

    // Pin whoever is new, and notice whoever changed (GRYT-727). Separate from
    // the list above so a slow evaluation never holds up drawing the sidebar —
    // a key decision changes what can be encrypted, not who is online.
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

        /*
         * This server is showing a message key you did not publish (GRYT-727).
         * A fact about the server, so it belongs here rather than in a card
         * somebody may never open.
         *
         * **Held back before it is shown, and taken away when it stops being
         * true** (GRYT-784). We publish our own key on join, so the first
         * member list of a session routinely arrives first and every join
         * flashed the warning. A real mismatch is still there seconds later.
         *
         * Not only timing: a second device derives a different key and
         * genuinely does mismatch, which is why the wording names that first.
         */
        const myId = myServerUserIdByHost.get(host);
        const toastId = `dm-key-rewritten-${host}`;
        const pending = dmKeyWarningTimers.get(host);

        if (myId && states[myId]?.ownKeyRewritten) {
          if (pending === undefined) {
            dmKeyWarningTimers.set(
              host,
              setTimeout(() => {
                dmKeyWarningTimers.delete(host);
                toast.error(
                  `${serversRef.current[host]?.name || host} has a message key this device did not publish. ` +
                    `That usually means you signed in on another device — restore your recovery phrase in Settings so both use the same key. ` +
                    `If you have not, treat direct messages here as readable by the server.`,
                  { id: toastId, duration: Infinity },
                );
              }, DM_KEY_WARNING_DELAY_MS),
            );
          }
        } else {
          if (pending !== undefined) {
            clearTimeout(pending);
            dmKeyWarningTimers.delete(host);
          }
          toast.dismiss(toastId);
        }
      })
      .catch(() => {
        // Storage that will not read, most likely. Leaving the previous states
        // alone is right: dropping them would make every peer look new.
      });

    // Record what this server actually holds for us. `serverProfiles` was only
    // written on a change, so a plain join left it empty and Settings fell back
    // to the local nickname — under the caption "This is how other users will
    // see you", beside a member list saying something else (GRYT-58). The
    // member list is the same data other people see, and nothing new is fetched.
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
