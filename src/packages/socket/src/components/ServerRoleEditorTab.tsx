import { Button, IconButton, Select, Surface, Switch } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { PiPlusBold, PiTrashBold } from "react-icons/pi";
import type { Socket } from "socket.io-client";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { groupPermissions } from "../lib/permissions";

type RoleDefinition = {
  id: string;
  name: string;
  color: string | null;
  rank: number;
  permissions: string[];
  isSystem: boolean;
  /** Null on either half means that half is not being asked for. */
  autoGrantAfterDays: number | null;
  autoGrantAfterMessages: number | null;
  memberCount: number;
};

type EditorState = {
  roles: RoleDefinition[];
  permissions: string[];
  defaults: { account: string; local: string };
};

/**
 * A role id, derived from the name somebody typed.
 *
 * Ids are not renameable — every membership row and both joining defaults point
 * at one — so this runs once, when the role is first saved, and never again.
 * Deriving rather than asking means nobody has to be told what a slug is, and
 * it is why a new role is held locally until it has a name: creating it on the
 * button press would mint `new-role-1a2b` and then be stuck with it.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** Marks the draft as one that does not exist on the server yet. */
const NEW_ROLE = "__new__";

/**
 * The role editor.
 *
 * Two decisions live on this screen. What each role may do, which is the list
 * of switches, and which role somebody lands on when they arrive, which is the
 * pair of pickers at the bottom. The second is the one that makes a public
 * server possible: a guest who may read and nothing else, an account that may
 * talk, and no moderator standing at the door handing out roles by hand.
 *
 * The permission catalogue comes from the server rather than from this file, so
 * a client older than the server it is talking to still shows every permission
 * that server has — see lib/permissions.
 */
export function ServerRoleEditorTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  const [state, setState] = useState<EditorState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RoleDefinition | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = () => {
    if (!socket?.connected) return;
    if (!accessToken) return;
    socket.emit("server:roles:definitions:list", { accessToken });
  };

  useSocketEvent<EditorState>(socket, "server:roles:definitions", (payload) => {
    if (!payload?.roles) return;
    setState(payload);
    setSaving(false);
    setSelectedId((current) => {
      if (current && payload.roles.some((r) => r.id === current)) return current;
      // Prefer something editable. Landing on the owner role — the one thing
      // the server refuses to save — would make the first thing anybody sees a
      // form that cannot be submitted.
      return payload.roles.find((r) => r.id !== "owner")?.id ?? null;
    });
  });

  // The server answers a save with the saved role and a broadcast, not with a
  // fresh list — two people can have this screen open, so ask again rather than
  // patching the copy in this tab.
  useSocketEvent(socket, "server:roles:definition:updated", () => {
    toast.success("Role saved.");
    refresh();
  });
  useSocketEvent<{ roleId: string; reassignTo: string; moved: number }>(
    socket,
    "server:roles:definition:deleted",
    (payload) => {
      toast.success(
        payload?.moved
          ? `Role deleted. ${payload.moved} member${payload.moved === 1 ? "" : "s"} moved to ${payload.reassignTo}.`
          : "Role deleted.",
      );
      setSelectedId(null);
      refresh();
    },
  );

  useEffect(() => {
    if (!host || !socket?.connected || !accessToken) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, socket?.connected, accessToken]);

  const creating = selectedId === NEW_ROLE;

  const selected = useMemo(
    () => state?.roles.find((r) => r.id === selectedId) ?? null,
    [state, selectedId],
  );

  // The draft is reset whenever the selection changes, so switching roles
  // discards half-finished edits rather than carrying them onto somebody else.
  // A role being created has no `selected` to reset from, so it is left alone.
  useEffect(() => {
    if (selectedId === NEW_ROLE) return;
    setDraft(selected ? { ...selected, permissions: [...selected.permissions] } : null);
  }, [selected, selectedId]);

  const dirty = useMemo(() => {
    if (creating) return Boolean(draft && slugify(draft.name));
    if (!draft || !selected) return false;
    return (
      draft.name !== selected.name ||
      draft.color !== selected.color ||
      draft.rank !== selected.rank ||
      draft.autoGrantAfterDays !== selected.autoGrantAfterDays ||
      draft.autoGrantAfterMessages !== selected.autoGrantAfterMessages ||
      draft.permissions.length !== selected.permissions.length ||
      draft.permissions.some((p) => !selected.permissions.includes(p))
    );
  }, [draft, selected, creating]);

  const groups = useMemo(
    () => groupPermissions(state?.permissions ?? []),
    [state?.permissions],
  );

  const roleOptions = useMemo(
    () =>
      (state?.roles ?? [])
        // The owner role is not something anybody can be given, so offering it
        // as a joining default would be offering a setting the server refuses.
        .filter((r) => r.id !== "owner")
        .map((r) => ({ label: `${r.name} (${r.id})`, value: r.id })),
    [state?.roles],
  );

  const emit = (event: string, payload: Record<string, unknown>) => {
    if (!socket?.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    socket.emit(event, { accessToken, ...payload });
  };

  const save = () => {
    if (!draft) return;
    const roleId = creating ? slugify(draft.name) : draft.id;
    if (!roleId) return toast.error("Give the role a name first.");
    if (creating && state?.roles.some((r) => r.id === roleId)) {
      return toast.error(`There is already a role called "${draft.name}".`);
    }
    setSaving(true);
    emit("server:roles:definitions:save", {
      roleId,
      name: draft.name,
      color: draft.color,
      rank: draft.rank,
      permissions: draft.permissions,
      autoGrantAfterDays: draft.autoGrantAfterDays,
      autoGrantAfterMessages: draft.autoGrantAfterMessages,
    });
    if (creating) setSelectedId(roleId);
  };

  const createRole = () => {
    // Held locally until it is saved, so the id can come from the name. Empty
    // and at the bottom: a new role that arrived with permissions already
    // ticked would be a role that did something before anybody looked at it.
    setSelectedId(NEW_ROLE);
    setDraft({
      id: NEW_ROLE,
      name: "",
      color: null,
      rank: 5,
      permissions: [],
      isSystem: false,
      autoGrantAfterDays: null,
      autoGrantAfterMessages: null,
      memberCount: 0,
    });
  };

  const remove = () => {
    if (!draft || draft.isSystem) return;
    if (creating) {
      setSelectedId(state?.roles.find((r) => r.id !== "owner")?.id ?? null);
      setDraft(null);
      return;
    }
    emit("server:roles:definitions:delete", {
      roleId: draft.id,
      reassignTo: state?.defaults.account,
    });
  };

  const togglePermission = (permission: string, on: boolean) => {
    setDraft((d) =>
      d
        ? {
            ...d,
            permissions: on
              ? [...d.permissions, permission]
              : d.permissions.filter((p) => p !== permission),
          }
        : d,
    );
  };

  if (!state) {
    return <span className="text-sm text-gryt-muted">Loading roles…</span>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="text-sm text-gryt-muted">
          A role is a set of permissions and a rank. Permissions are what somebody may do;
          rank is who they may act on. Kicks, bans and role changes always refuse against an
          equal or higher rank.
        </span>
      </div>

      <div className="flex gap-4 items-start flex-wrap">
        <div className="flex flex-col gap-2" style={{ minWidth: 220, flex: "0 0 220px" }}>
          {state.roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedId(role.id)}
              className={`flex items-center justify-between gap-2 rounded-(--gryt-radius-md) px-3 py-2 text-left text-sm ${
                role.id === selectedId ? "bg-gryt-surface-raised" : "hover:bg-gryt-surface-raised"
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: role.color || "var(--gryt-muted, #666)",
                  }}
                />
                <span className="truncate">{role.name}</span>
              </span>
              <span className="flex items-center gap-1 shrink-0">
                {(role.autoGrantAfterDays !== null || role.autoGrantAfterMessages !== null) && (
                  <span className="text-xs text-gryt-muted" title="Given out automatically">
                    auto
                  </span>
                )}
                <span className="text-xs text-gryt-muted">{role.memberCount}</span>
              </span>
            </button>
          ))}

          {creating && (
            <div className="flex items-center gap-2 rounded-(--gryt-radius-md) bg-gryt-surface-raised px-3 py-2 text-sm">
              <span className="truncate">{draft?.name || "New role"}</span>
              <span className="text-xs text-gryt-muted">unsaved</span>
            </div>
          )}

          <Button tone="neutral" size="small" onClick={createRole} disabled={saving || creating}>
            <PiPlusBold size={14} /> New role
          </Button>
        </div>

        <Surface style={{ flex: "1 1 380px", minWidth: 320 }}>
          {!draft ? (
            <span className="text-sm text-gryt-muted">Pick a role to edit.</span>
          ) : draft.id === "owner" ? (
            <span className="text-sm text-gryt-muted">
              The owner holds every permission and cannot be edited. It is what the server
              falls back to if anything else here goes wrong, which is the only reason
              a mistake on this screen is recoverable.
            </span>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex flex-col gap-1">
                  <input
                    value={draft.name}
                    maxLength={32}
                    placeholder="Name this role"
                    autoFocus={creating}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    className="bg-transparent text-base font-bold outline-none border-b border-gryt-border"
                  />
                  <span className="text-xs text-gryt-muted">
                    {/* Shown while it is still being chosen, because it is the
                        one thing here that cannot be changed afterwards. */}
                    id: {creating ? slugify(draft.name) || "…" : draft.id}
                    {draft.isSystem ? " · built in" : ""}
                  </span>
                </div>

                {!draft.isSystem && (
                  <IconButton
                    tone="danger"
                    size="xsmall"
                    aria-label={creating ? "Discard this role" : "Delete this role"}
                    onClick={remove}
                    disabled={saving}
                  >
                    <PiTrashBold size={14} />
                  </IconButton>
                )}
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-gryt-muted">Colour</span>
                  <input
                    type="color"
                    value={draft.color || "#888888"}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                  />
                  {draft.color && (
                    <Button tone="ghost" size="xsmall" onClick={() => setDraft({ ...draft, color: null })}>
                      Clear
                    </Button>
                  )}
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <span className="text-gryt-muted">Rank</span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={draft.rank}
                    onChange={(e) => setDraft({ ...draft, rank: Number(e.target.value) })}
                    className="w-16 bg-transparent border-b border-gryt-border outline-none"
                  />
                </label>
              </div>

              {!draft.isSystem && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold">Given out automatically</span>
                    <span className="text-xs text-gryt-muted">
                      Leave both blank and this role is only ever handed out by hand. Fill
                      both in and somebody gets it once they have been here that long{" "}
                      <em>and</em> posted that many messages — both, not either, because
                      time on its own is something a patient stranger also has.
                    </span>
                  </div>

                  <div className="flex gap-4 flex-wrap">
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-gryt-muted">After days</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="—"
                        value={draft.autoGrantAfterDays ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            autoGrantAfterDays: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        className="w-20 bg-transparent border-b border-gryt-border outline-none"
                      />
                    </label>

                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-gryt-muted">After messages</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="—"
                        value={draft.autoGrantAfterMessages ?? ""}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            autoGrantAfterMessages: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        className="w-20 bg-transparent border-b border-gryt-border outline-none"
                      />
                    </label>
                  </div>

                  <span className="text-xs text-gryt-muted">
                    It only ever promotes. Nobody is moved down for going quiet, and
                    anyone already holding a higher role is left where they are. Checked
                    when somebody joins and after they post, so a role earned while they
                    were away arrives the next time they turn up.
                  </span>
                </div>
              )}

              {groups.map((group) => (
                <div key={group.title} className="flex flex-col gap-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold">{group.title}</span>
                    <span className="text-xs text-gryt-muted">{group.description}</span>
                  </div>

                  {group.permissions.map((permission) => (
                    <div key={permission.id} className="flex items-start justify-between gap-3">
                      <div className="flex flex-col">
                        <span className="text-sm">{permission.label}</span>
                        {permission.description && (
                          <span className="text-xs text-gryt-muted">{permission.description}</span>
                        )}
                      </div>
                      <Switch
                        checked={draft.permissions.includes(permission.id)}
                        onCheckedChange={(on: boolean) => togglePermission(permission.id, on)}
                      />
                    </div>
                  ))}
                </div>
              ))}

              <div className="flex justify-end gap-2">
                <Button
                  tone="neutral"
                  size="small"
                  onClick={() => setDraft(selected ? { ...selected, permissions: [...selected.permissions] } : null)}
                  disabled={!dirty || saving}
                >
                  Reset
                </Button>
                <Button size="small" onClick={save} disabled={!dirty || saving}>
                  Save
                </Button>
              </div>
            </div>
          )}
        </Surface>
      </div>

      <Surface>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-bold">When somebody joins</span>
            <span className="text-xs text-gryt-muted">
              Split by how they proved who they are. An account is a durable identity a
              certificate authority vouched for; a guest is a key generated in the browser,
              which anybody can throw away and mint again. Only new members are affected —
              changing this never re-sorts the people already here.
            </span>
          </div>

          <div className="flex gap-4 flex-wrap">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gryt-muted">With an account</span>
              <Select
                value={state.defaults.account}
                onValueChange={(v) => emit("server:roles:defaults:set", { accountRoleId: String(v) })}
                options={roleOptions}
                size="small"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-gryt-muted">As a guest</span>
              <Select
                value={state.defaults.local}
                onValueChange={(v) => emit("server:roles:defaults:set", { localRoleId: String(v) })}
                options={roleOptions}
                size="small"
              />
            </label>
          </div>

          <span className="text-xs text-gryt-muted">
            Guests only reach this server at all if it accepts self-signed identities —
            GRYT_IDENTITY_TIERS on the server. Where it does not, the guest default is
            never used.
          </span>
        </div>
      </Surface>
    </div>
  );
}
