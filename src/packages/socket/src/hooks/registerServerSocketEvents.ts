import { warmSfuSelection } from "@gryt/voice";
import { Dispatch, MutableRefObject, SetStateAction } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import {
  getServerAccessToken,
  getServerRefreshToken,
  getStoredWorn,
  getUploadsFileUrl,
  removeServerAccessToken,
  removeServerRefreshToken,
  setServerAccessToken,
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
 * the server actually holds, but nothing in the list says which entry is you.
 * This is how the two are joined up so the per-server profile can show the
 * server's value instead of quietly falling back to the local one.
 */
const myServerUserIdByHost = new Map<string, string>();

/**
 * What `firstTimeOnThisSocket` is asked about below (GRYT-758).
 *
 * `publishDmKey` used to run only from `server:joined`, and the server emits
 * that from one place: the `server:verify` handler. A client that already holds
 * a token never goes near it — `useSockets` sends `session:restore` on connect
 * instead — so everybody who was already a member of a server published no key
 * at all, and encrypted DMs were on for new members only. Nothing errored, and
 * the composer correctly reported that the other side had published nothing.
 *
 * `server:details` is the one signal both routes produce, and it is already
 * what this client treats as the restore having landed.
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

export function registerServerSocketEvents(socket: Socket, host: string, ctx: ServerEventContext) {
  /**
   * Who is in each call on this server, as last heard.
   *
   * Held here rather than in state because nothing renders it directly — it is
   * only ever used to put the conversation id back onto `clients`, which is
   * what everything downstream already groups by. And it has to be remembered
   * rather than applied once: the next `server:clients` arrives with the id
   * blanked out again, so this is re-applied on every one of them.
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

  socket.on("server:details", (data: serverDetails) => {
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
      setCustomEmojis(list, host);
    });
  });

  socket.on("server:joined", (joinInfo: { accessToken: string; refreshToken?: string; nickname: string; avatarFileId?: string | null; avatarWorn?: string | null }) => {
    setServerAccessToken(host, joinInfo.accessToken);

    // Say what key to encrypt to us here (GRYT-727). Not awaited: nothing else
    // in this handler depends on it, and a key that never arrives means no
    // encrypted messages rather than a join that failed.
    //
    // Kept alongside the `server:details` publish rather than replaced by it. A
    // first join produces both, and this one is the earlier of the two — the
    // key is on the server before the first member list goes out rather than
    // after it, so nobody sees the new member appear without one.
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
    // per-server once it is set — somebody can be a pirate in one place and
    // plain everywhere else — so pushing it on every reconnect would undo a
    // per-server choice every time the socket dropped. `server:joined` fires on
    // reconnects too, which is why the condition is about what the server
    // already holds rather than about this being a first join.
    const storedWorn = getStoredWorn();
    if (storedWorn && !joinInfo.avatarWorn) {
      socket.emit("profile:update", { avatarWorn: storedWorn });
    }

    socket.emit("server:details");
    socket.emit("members:fetch");

    // Read when the event fires, not when the handler was registered. These
    // handlers are registered once per socket, and the socket is created as
    // soon as Keycloak has initialised — while useUserId is still resolving
    // the account's sub in an effect of its own. Capturing the value meant
    // `userId` was usually still null here, so the sync was skipped and never
    // tried again, because server:joined only fires once.
    //
    // The owner is the one this always caught: their membership is created by
    // this very event, at the earliest moment the app can reach a server, so
    // the race is not a race for them — it is a certainty (GRYT-12).
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

  socket.on("server:kicked", (data: { reason?: string; action?: "kick" | "ban" }) => {
    const serverName = serversRef.current[host]?.name || host;
    toast.error(data?.reason ? `${serverName}: ${data.reason}` : `You were removed from ${serverName}.`);

    // Both, not just the access token. Keeping the refresh token is what let a
    // kicked client mint a new access token and walk straight back in — the
    // handler immediately below this one has always removed both.
    removeServerAccessToken(host);
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

    // Refused for what this identity is rather than for who it is: the server
    // does not admit this tier at all. This one the server does explain, and it
    // says so in `server:info` before anyone tries, so the message is passed
    // straight through.
    //
    // Recorded like the refusals below because that is what ends the attempt.
    // Without it this fell to the generic branch, which toasts the raw error
    // code and records nothing — so the connection never reached a terminal
    // state, the panel sat on the connecting skeleton until its timeout, and
    // the app blamed network conditions for a "no" that had arrived
    // immediately. The retry loops kept asking for as long as it stayed open.
    //
    // Tokens are deliberately left alone, unlike the refusals below. Signing
    // back in is the whole fix, and what was rejected is the identity in hand,
    // not anything stored for this server.
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
         * This server is showing other members a key you did not publish
         * (GRYT-727). Not a fact about one person — a fact about the server —
         * so it does not belong in a card somebody may never open.
         *
         * `duration: Infinity` and a stable id: it stays until dismissed, and
         * every later member list lands on the same toast rather than stacking
         * a new one. A warning about a server that is lying should not be
         * something you can miss by looking away.
         */
        const myId = myServerUserIdByHost.get(host);
        if (myId && states[myId]?.ownKeyRewritten) {
          toast.error(
            `${serversRef.current[host]?.name || host} is showing a message key that is not yours. Treat direct messages here as readable by the server until you know why.`,
            { id: `dm-key-rewritten-${host}`, duration: Infinity },
          );
        }
      })
      .catch(() => {
        // Storage that will not read, most likely. Leaving the previous states
        // alone is right: dropping them would make every peer look new.
      });

    // Record what this server actually holds for us.
    //
    // serverProfiles was only ever written in response to a change —
    // profile:updated fires after profile:update or avatar:updated — so on a
    // plain join it stayed empty and the per-server tab in Settings fell back
    // to the locally stored nickname. It therefore showed the local value under
    // the caption "This is how other users will see you" while the member list
    // beside it showed something else entirely, which is how the GRYT-58
    // desync went unnoticed for so long.
    //
    // The member list is the same data other people see, so it is the right
    // source. Nothing new is fetched.
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
