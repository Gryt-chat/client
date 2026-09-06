import { Button, Chip, Select, Surface, Tooltip } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { useServerPermissions } from "../hooks/usePermissions";
import { useSocketEvent } from "../hooks/useSocketEvent";
import { useSockets } from "../hooks/useSockets";
import { inviteState, type MemberInvite } from "./memberInvite";

/**
 * A role id. Was one of four names; a server defines its own now, so the list
 * of what can be picked comes off `server:details` rather than out of this
 * file.
 */
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
  const members = host ? (memberLists[host] || []) : [];
  const { roles: definitions, has } = useServerPermissions(host);

  const nameOf = useMemo(() => {
    const map = new Map(definitions.map((r) => [r.id, r.name]));
    return (id: Role) => map.get(id) ?? id;
  }, [definitions]);

  const [roles, setRoles] = useState<Record<string, Role[]>>({});
  const [submitting, setSubmitting] = useState(false);

  /**
   * How each member got in, keyed by member.
   *
   * Empty against a server too old to answer, and against anybody without
   * `manage_invites` — in both cases the column simply is not drawn, rather
   * than drawn empty and implying nobody used an invite.
   */
  const [invites, setInvites] = useState<Record<string, MemberInvite>>({});
  const [invitesAnswered, setInvitesAnswered] = useState(false);

  /* `has` rather than `can`: this one is strict. `can` is optimistic about a
     permission the server has not mentioned, and firing a request that comes
     back refused is worse than not asking. */
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

      <div className="flex justify-end gap-2">
        <Button tone="neutral" size="small" onClick={refresh} disabled={submitting}>
          Refresh
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {members.length === 0 ? (
          <span className="text-sm text-gryt-muted">
            No members found.
          </span>
        ) : (
          members.map((m) => {
            const held = roles[m.serverUserId] ?? [];
            const isOwner = held.includes(OWNER_ROLE);

            const invite = invites[m.serverUserId];
            const state = invite ? inviteState(invite) : null;

            // Only what they do not already hold. Offering a role somebody has
            // is offering a click that changes nothing.
            const available = definitions
              .filter((r) => r.id !== OWNER_ROLE && !held.includes(r.id))
              .map((r) => ({ label: r.name, value: r.id }));

            return (
              <Surface key={m.serverUserId}>
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-bold">
                      {m.nickname}
                    </span>
                    <span className="text-xs text-gryt-muted">
                      ID: {m.serverUserId}
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
                  </div>
                </div>
              </Surface>
            );
          })
        )}
      </div>
    </div>
  );
}
