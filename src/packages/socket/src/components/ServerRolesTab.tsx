import { Button, Checkbox, Chip, Menu, Select, Surface, TextField, Tooltip } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { PiBootFill, PiDotsThreeVerticalBold, PiProhibitFill } from "../../../../lib/icons";
import { useServerPermissions } from "../hooks/usePermissions";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { useSockets } from "../hooks/useSockets";
import { BAN_DURATIONS, formatJoined, makeRankOf, TIER_LABEL } from "../lib/memberFacts";
import { emitAuthenticated } from "../utils/tokenManager";
import { ConfirmDialog } from "./ConfirmDialog";
import { inviteState, type MemberInvite } from "./memberInvite";

/** A server defines its own roles, so what can be picked comes off
    `server:details` rather than this file. */
type Role = string;

/** Ownership is the server's, not a role to hand out, so it is never offered. */
const OWNER_ROLE = "owner";

/** "Member and Moderator", the way somebody would read a list out loud. */
function listNames(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function ServerRolesTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  const { memberLists, requestMemberList } = useSockets();
  // Memoised because the search reads it: `|| []` is a fresh array every render,
  // so the filter would re-run whether or not anything moved.
  const allMembers = useMemo(() => (host ? memberLists[host] || [] : []), [host, memberLists]);
  const { roles: definitions, has, roleId: myRoleId } = useServerPermissions(host);

  const [query, setQuery] = useState("");

  /** By nickname, and by id for somebody working from a log line. Searching is
      what stops the mistake of acting on the row above the right person. */
  const members = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allMembers;
    return allMembers.filter(
      (m) =>
        m.nickname?.toLowerCase().includes(q) ||
        m.serverUserId?.toLowerCase().includes(q),
    );
  }, [allMembers, query]);

  const nameOf = useMemo(() => {
    const map = new Map(definitions.map((r) => [r.id, r.name]));
    return (id: Role) => map.get(id) ?? id;
  }, [definitions]);

  const [roles, setRoles] = useState<Record<string, Role[]>>({});
  const [submitting, setSubmitting] = useState(false);

  /** Empty against an older server and against anybody without `manage_invites`:
      the column is not drawn rather than drawn empty. */
  const [invites, setInvites] = useState<Record<string, MemberInvite>>({});
  const [invitesAnswered, setInvitesAnswered] = useState(false);

  /* `has` rather than `can`, which is optimistic about a permission the server
     has not mentioned: a refused request is worse than not asking. */
  const maySeeInvites = has("manage_invites");

  const refresh = () => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:roles:list", { accessToken });
    if (maySeeInvites) socket.emit("server:members:invites", { accessToken });
    requestMemberList(host);
  };

  /*
   * `roles` is what a server that knows about more than one per member sends;
   * `role` is what one from before that sends, and what this used to read. A
   * server still on the old build keeps working, showing the one role it has.
   */
  useSocketEvent<{ roles: { serverUserId: string; role: Role; roles?: Role[] }[] }>(
    socket,
    "server:roles",
    (payload) => {
      const map: Record<string, Role[]> = {};
      (payload?.roles || []).forEach((r) => {
        if (r?.serverUserId) map[r.serverUserId] = r.roles ?? (r.role ? [r.role] : []);
      });
      setRoles(map);
    },
  );

  useSocketEvent<{ serverUserId: string; role: Role; roles?: Role[] }>(
    socket,
    "server:role:updated",
    (payload) => {
      if (!payload?.serverUserId) return;
      const held = payload.roles ?? (payload.role ? [payload.role] : []);
      setRoles((prev) => ({ ...prev, [payload.serverUserId]: held }));
      // The real confirmation, in place of the one that used to fire before the
      // server had said anything.
      toast.success(
        held.length === 0
          ? "No roles now."
          : `Now ${listNames(held.map(nameOf))}.`,
      );
    },
  );

  useSocketEvent<{ members: MemberInvite[] }>(
    socket,
    "server:members:invites",
    (payload) => {
      const map: Record<string, MemberInvite> = {};
      (payload?.members || []).forEach((m) => {
        if (m?.serverUserId) map[m.serverUserId] = m;
      });
      setInvites(map);
      setInvitesAnswered(true);
    },
  );

  /* Repaint on a revoke from anywhere — this tab, the Invites tab, or somebody
     else's client. The row says whether the door is still open, so it has to
     stop saying "live" the moment it is not. */
  useSocketEvent<{ code?: string }>(socket, "server:invite:revoked", (payload) => {
    const code = payload?.code;
    if (!code) return;
    setInvites((prev) => {
      const next: Record<string, MemberInvite> = {};
      for (const [id, invite] of Object.entries(prev)) {
        next[id] = invite.code === code ? { ...invite, revoked: true } : invite;
      }
      return next;
    });
  });

  const revokeInvite = (code: string) => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit("server:invites:revoke", { accessToken, code });
  };

  useEffect(() => {
    if (!host) return;
    if (!socket?.connected) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected]);

  // ── Kicking and banning ──────────────────────────────────────────
  //
  // Emitted from here rather than through useAdminActions, which is mounted
  // under serverView and bound to whichever server is being looked at. The
  // settings modal is a sibling with its own socket, so reaching that hook
  // would mean lifting it above both. The events are the same two.
  //
  // `emitAuthenticated` rather than this tab's `accessToken`, because it
  // refreshes a token that is about to expire first. Settings is a window
  // somebody leaves open.
  const [pendingKick, setPendingKick] = useState<{ id: string; nickname: string } | null>(null);
  const [pendingBan, setPendingBan] = useState<{ id: string; nickname: string } | null>(null);
  const [reason, setReason] = useState("");
  const [banDuration, setBanDuration] = useState("permanent");
  const [banDeleteContent, setBanDeleteContent] = useState(true);

  useEffect(() => {
    if (pendingKick || pendingBan) {
      setReason("");
      setBanDuration("permanent");
      setBanDeleteContent(true);
    }
  }, [pendingKick, pendingBan]);

  const moderate = async (event: string, payload: Record<string, unknown>) => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    const sent = await emitAuthenticated(socket, event, payload, host);
    if (!sent) toast.error("Not signed in to this server — try reconnecting.");
  };

  const rankOf = makeRankOf(definitions);
  const myRank = rankOf(myRoleId);
  const mayKick = has("kick_members");
  const mayBan = has("ban_members");

  /*
   * Add and remove rather than replace.
   *
   * `server:roles:set` still exists and still replaces the whole set — it is
   * what a demotion means — but this screen is where somebody is given a second
   * role, and sending the whole intended set would make every change a chance
   * to drop one by accident.
   */
  const send = (event: string, serverUserId: string, role: Role) => {
    if (!socket || !socket.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    setSubmitting(true);
    try {
      // No success toast here. It used to fire unconditionally, before any
      // acknowledgement, so the owner-only and self-change cases the server
      // rejects still reported "Role updated". server:role:updated above is
      // the actual confirmation; a refusal arrives as server:error.
      socket.emit(event, { accessToken, serverUserId, role });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm text-gryt-muted">
        Who holds which role. Somebody can hold several, and the roles add up. They can do
        anything any of their roles allows. What each role can do is on the Role editor tab.
        You can only give a role to somebody you outrank. And only roles below your own rank.
      </span>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${allMembers.length} ${allMembers.length === 1 ? "member" : "members"}`}
          />
        </div>
        <Button tone="neutral" size="small" onClick={refresh} disabled={submitting}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {members.length === 0 ? (
          <span className="text-sm text-gryt-muted">
            {query.trim() ? `Nobody here matches "${query.trim()}".` : "No members found."}
          </span>
        ) : (
          members.map((m) => {
            const held = roles[m.serverUserId] ?? [];
            const isOwner = held.includes(OWNER_ROLE);

            const invite = invites[m.serverUserId];
            const state = invite ? inviteState(invite) : null;

            const tier = m.identityTier ? TIER_LABEL[m.identityTier] : undefined;
            const joined = formatJoined(m.createdAt);

            // Rank decides who may be acted on, permissions decide what the
            // action is. Same rule as the right-click menu in the sidebar, and
            // the server enforces it again -- offering a click that comes back
            // refused is worse than not offering it.
            // The highest they hold, not the first. Roles stack here, so
            // ranking somebody by whichever one the server happened to list
            // first would let a moderator ban an admin who is also a
            // contributor.
            const theirRank = held.reduce((top, r) => Math.max(top, rankOf(r)), -1);
            const outranked = myRank > theirRank;
            const canKick = mayKick && outranked;
            const canBan = mayBan && outranked;

            // Only what they do not already hold. Offering a role somebody has
            // is offering a click that changes nothing.
            const available = definitions
              .filter((r) => r.id !== OWNER_ROLE && !held.includes(r.id))
              .map((r) => ({ label: r.name, value: r.id }));

            return (
              <Surface key={m.serverUserId}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold">
                        {m.nickname}
                      </span>
                      {/* What is behind them. Amber is "no account" and nothing
                          else, the same as on the hover card: a local identity
                          costs nothing to replace, so a ban on one is worth
                          less than a ban on an account, and that is the thing
                          somebody moderating needs to see before they act. */}
                      {tier && (
                        <Chip
                          label={tier.label}
                          tone={tier.amber ? "warning" : "neutral"}
                        />
                      )}
                    </span>
                    <span className="text-xs text-gryt-muted">
                      ID: {m.serverUserId}
                      {joined && <> · Joined {joined}</>}
                    </span>

                    {/* How they got in (GRYT-923).

                        Only where the server answered and this member arrived
                        on an invite. Somebody who has none is drawn with
                        nothing rather than "no invite": the first member claims
                        the server and an open join needs no code, so an absent
                        entry is ordinary and a label saying so would be noise
                        on most rows. */}
                    {maySeeInvites && invitesAnswered && invite && (
                      <span className="flex items-center gap-1.5 text-xs">
                        <span className="text-gryt-muted">Joined with</span>
                        {/* The note where there is one, because "Kari's
                            friends" is what an operator recognises and the code
                            is a random string. The code stays reachable on
                            hover, since it is what the Invites tab lists. */}
                        <Tooltip title={state!.hint}>
                          <span
                            style={{
                              fontFamily: "var(--code-font-family)",
                              color: state!.dead ? "var(--gryt-neutral-10)" : "var(--gryt-text)",
                              textDecoration: state!.dead ? "line-through" : undefined,
                            }}
                          >
                            {state!.label}
                          </span>
                        </Tooltip>
                        {state!.reason && (
                          <span className="text-gryt-muted">· {state!.reason}</span>
                        )}
                        {!state!.dead && (
                          <Button
                            tone="ghost"
                            size="xsmall"
                            onClick={() => revokeInvite(invite.code)}
                            disabled={submitting}
                          >
                            Revoke
                          </Button>
                        )}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {held.length === 0 && (
                      // Not an error. Somebody with no role falls back to
                      // whatever the server gives a new arrival, so saying
                      // "none" would be wrong about what they can do.
                      <span className="text-sm text-gryt-muted">Same as a new member</span>
                    )}

                    {held.map((r) => (
                      <Chip
                        key={r}
                        label={nameOf(r)}
                        tone={r === OWNER_ROLE ? "primary" : "neutral"}
                        // The owner's chip has no remove: the server refuses to
                        // take it away here, because ownership lives in the
                        // server's own configuration rather than in this list.
                        onDelete={
                          r === OWNER_ROLE || submitting
                            ? undefined
                            : () => send("server:roles:remove", m.serverUserId, r)
                        }
                      />
                    ))}

                    {!isOwner && available.length > 0 && (
                      <Select
                        value=""
                        onValueChange={(v) => {
                          // Checked before String(), not after. The select
                          // clears itself once the role is given and fires this
                          // again with null — and `String(null)` is "null",
                          // which is truthy, so a second request went out
                          // asking for a role called "null".
                          if (v === null || v === undefined || v === "") return;
                          send("server:roles:add", m.serverUserId, String(v));
                        }}
                        options={available}
                        placeholder="Give a role"
                        size="small"
                        disabled={submitting}
                      />
                    )}

                    {(canKick || canBan) && (
                      <Menu.Root>
                        <Menu.Trigger
                          render={
                            <Button tone="ghost" size="small" aria-label={`Actions for ${m.nickname}`}>
                              <PiDotsThreeVerticalBold size={16} />
                            </Button>
                          }
                        />
                        <Menu.Portal>
                          <Menu.Positioner align="end">
                            <Menu.Popup>
                              {canKick && (
                                <Menu.Item
                                  onClick={() =>
                                    setPendingKick({ id: m.serverUserId, nickname: m.nickname })
                                  }
                                >
                                  <PiBootFill size={16} />
                                  Kick from server
                                </Menu.Item>
                              )}
                              {canBan && (
                                <Menu.Item
                                  className="text-gryt-danger"
                                  onClick={() =>
                                    setPendingBan({ id: m.serverUserId, nickname: m.nickname })
                                  }
                                >
                                  <PiProhibitFill size={16} />
                                  Ban from server
                                </Menu.Item>
                              )}
                            </Menu.Popup>
                          </Menu.Positioner>
                        </Menu.Portal>
                      </Menu.Root>
                    )}
                  </div>
                </div>
              </Surface>
            );
          })
        )}
      </div>

      {/* A kick is an interruption -- they can walk back in the moment they are
          out -- so it confirms and asks for a reason, and no more than that. */}
      <ConfirmDialog
        open={!!pendingKick}
        onOpenChange={(open) => { if (!open) setPendingKick(null); }}
        title={`Kick ${pendingKick?.nickname}?`}
        description="They are disconnected and can join again straight away."
        confirmLabel="Kick"
        onConfirm={() => {
          if (!pendingKick) return;
          void moderate("server:kick", {
            targetServerUserId: pendingKick.id,
            reason: reason.trim() || undefined,
          });
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs">Reason (optional — shown to them)</span>
          <TextField
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Spamming the general channel"
            maxLength={200}
          />
        </div>
      </ConfirmDialog>

      {/* A ban is not, so it asks for the name to be typed back. The mistake
          this screen makes is acting on the row above or below the one somebody
          meant, and a list of similar nicknames is exactly where that happens.
          Deliberately without the invite-revoking option the sidebar's ban
          dialog offers: that needs a round trip this tab does not make, and
          half of it, silently defaulted, would be worse than none. */}
      <ConfirmDialog
        open={!!pendingBan}
        onOpenChange={(open) => { if (!open) setPendingBan(null); }}
        title={`Ban ${pendingBan?.nickname}?`}
        description="They are removed and cannot rejoin until the ban lifts."
        confirmLabel="Ban"
        confirmPhrase={pendingBan?.nickname}
        confirmPhraseLabel={<>Type <strong>{pendingBan?.nickname}</strong> to confirm</>}
        onConfirm={() => {
          if (!pendingBan) return;
          const minutes = BAN_DURATIONS.find((d) => d.value === banDuration)?.minutes ?? null;
          void moderate("server:ban", {
            targetServerUserId: pendingBan.id,
            reason: reason.trim() || undefined,
            expiresInMinutes: minutes,
            deleteContent: banDeleteContent,
            revokeInvite: false,
          });
        }}
      >
        <div className="flex flex-col gap-1">
          <span className="text-xs">Reason (optional — shown to them)</span>
          <TextField
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Repeated harassment after a warning"
            maxLength={200}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs">Duration</span>
          <Select
            value={banDuration}
            onValueChange={(v) => setBanDuration(String(v))}
            options={BAN_DURATIONS.map((d) => ({ label: d.label, value: d.value }))}
          />
        </div>
        <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Checkbox
            checked={banDeleteContent}
            onCheckedChange={(v) => setBanDeleteContent(v === true)}
          />
          Delete their messages and reactions
        </label>
        {!banDeleteContent && (
          <span className="text-xs text-gryt-muted">
            Their messages stay. Unbanning restores access but never restores
            deleted messages, so this is the only chance to keep them.
          </span>
        )}
      </ConfirmDialog>
    </div>
  );
}
