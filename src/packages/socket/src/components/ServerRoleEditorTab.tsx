import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, IconButton, Select, Surface } from "@gryt/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { PiPlusBold, PiTrashBold } from "react-icons/pi";
import type { Socket } from "socket.io-client";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { nextUnusedPreset,ROLE_COLOR_PRESETS } from "./roleColorPresets";
import { byRank, OWNER_ROLE, ranksAfterMove } from "./roleOrder";
import { type GridRole,RolePermissionGrid } from "./RolePermissionGrid";

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
  /** Whether an invite may be bound to this role. Off until somebody ticks it. */
  grantableByInvite: boolean;
  memberCount: number;
};

type EditorState = {
  roles: RoleDefinition[];
  permissions: string[];
  defaults: { account: string; local: string };
  /**
   * Which identities this server admits, from `GRYT_IDENTITY_TIERS`.
   *
   * Optional because a server older than GRYT-907 does not send it. Where it is
   * absent the guest controls stay exactly as they were rather than being
   * switched off on a guess.
   */
  identityTiers?: string[];
};

/**
 * A role id, derived from the name somebody typed.
 *
 * Ids are not renameable — every membership row and both joining defaults point
 * at one — so this runs once, when the role is first saved, and never again.
 * It is why a new role is held locally until it has a name: creating it on the
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
 * Roles the grid draws but will not let you edit.
 *
 * `owner` is the only one, and the server refuses to save it — an editable
 * column would be one whose every change came back rejected. Shown rather than
 * hidden, because leaving it out would make the grid look like it was missing
 * a role.
 */
const READ_ONLY_ROLES = new Set(["owner"]);

/**
 * One row of the role list, draggable. The handle is the whole row: a role list
 * is short and the rows are already one tap target each, and dnd-kit's pointer
 * sensor only starts a drag after 5px of movement, so a click still selects.
 */
function SortableRole({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.85 : 1,
        zIndex: isDragging ? 10 : undefined,
        cursor: disabled ? "default" : isDragging ? "grabbing" : "grab",
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

/**
 * Ten swatches, a picker and a Clear. Swatches first, because the answer is
 * nearly always "one that looks like the others" and these ten are one family
 * by construction. Marked with a ring rather than a tick: a tick has to be
 * drawn in some colour, and none reads on all ten.
 */
function RoleColorField({
  value,
  onChange,
  onCommit,
}: {
  value: string | null;
  onChange: (color: string | null) => void;
  /** Takes the colour rather than reading it back — see `commitSettings`. */
  onCommit: (color: string | null) => void;
}) {
  const selected = value?.toLowerCase() ?? null;
  const isPreset = ROLE_COLOR_PRESETS.some((p) => p.value.toLowerCase() === selected);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {ROLE_COLOR_PRESETS.map((preset) => {
        const active = preset.value.toLowerCase() === selected;
        return (
          <button
            key={preset.value}
            type="button"
            aria-label={preset.name}
            aria-pressed={active}
            title={preset.name}
            onClick={() => {
              // Committed on the press rather than on blur: a swatch is a
              // decision the moment it is pressed, and pressing one and
              // closing the panel should not be the case that loses it.
              onChange(preset.value);
              onCommit(preset.value);
            }}
            className="cursor-pointer rounded-full border-0 p-0"
            style={{
              width: 22,
              height: 22,
              background: preset.value,
              outline: active ? "2px solid var(--gryt-text)" : "none",
              outlineOffset: 2,
            }}
          />
        );
      })}

      {/* The picker keeps its place for anybody matching a brand colour, and
          wears whatever is currently set so a custom colour is visible as a
          swatch of its own rather than only as a value. */}
      <label
        className="flex items-center gap-1 text-xs text-gryt-muted cursor-pointer"
        title="Any other colour"
      >
        <input
          type="color"
          value={value || "#888888"}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          aria-label="Any other colour"
          style={{
            width: 22,
            height: 22,
            padding: 0,
            border: 0,
            background: "none",
            cursor: "pointer",
            outline: value && !isPreset ? "2px solid var(--gryt-text)" : "none",
            outlineOffset: 2,
          }}
        />
        Custom
      </label>

      {value && (
        <Button
          tone="ghost"
          size="xsmall"
          onClick={() => {
            onChange(null);
            onCommit(null);
          }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}

/**
 * The role editor: what each role may do, and which role somebody lands on when
 * they arrive.
 *
 * **The permission catalogue comes from the server, not this file**, so a
 * client older than the server still shows every permission it has — see
 * lib/permissions.
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

  /**
   * Permission edits for every role, keyed by role id.
   *
   * The grid edits all of them at once and the save event takes one role with
   * its whole permission list, so a matrix that changed three roles is three
   * saves. `draft` above is still the *settings* of the one selected role, none
   * of which the grid touches.
   *
   * Seeded from the server's answer and reset by it, so somebody else saving
   * while this is open replaces what is here rather than merging into it.
   */
  const [permDrafts, setPermDrafts] = useState<Record<string, string[]>>({});

  /**
   * How many saves are still outstanding.
   *
   * A ref rather than state: the socket handler that decrements it is
   * registered once, so it would close over the first value forever.
   */
  const pendingSaves = useRef(0);

  const refresh = () => {
    if (!socket?.connected) return;
    if (!accessToken) return;
    socket.emit("server:roles:definitions:list", { accessToken });
  };

  useSocketEvent<EditorState>(socket, "server:roles:definitions", (payload) => {
    if (!payload?.roles) return;
    setState(payload);
    setSaving(false);
    // Not while a write is still in the air. Ticking two boxes quickly sends
    // two saves, and the list that comes back for the first does not know
    // about the second yet — adopting it would un-tick the box that was just
    // ticked until the second reply landed.
    if (pendingSaves.current === 0) {
      setPermDrafts(
        Object.fromEntries(payload.roles.map((r) => [r.id, [...r.permissions]])),
      );
    }
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
    // No toast. Every edit here is its own save now, so one per reply would be
    // a stack of them for a row of ticks — and a toast confirming a write is
    // the wrong thing to spend a person's attention on anyway. The tick that
    // stayed ticked is the confirmation.
    if (pendingSaves.current > 0) pendingSaves.current -= 1;
    if (pendingSaves.current > 0) return;
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
      draft.grantableByInvite !== selected.grantableByInvite ||
      draft.autoGrantAfterDays !== selected.autoGrantAfterDays ||
      draft.autoGrantAfterMessages !== selected.autoGrantAfterMessages
    );
  }, [draft, selected, creating]);

  /**
   * The roles as the grid sees them: the server's list, with this tab's
   * unsaved permission edits laid over the top.
   */
  const gridRoles: GridRole[] = useMemo(
    () =>
      (state?.roles ?? []).map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        rank: role.rank,
        permissions: permDrafts[role.id] ?? role.permissions,
      })),
    [state?.roles, permDrafts],
  );

  /**
   * The list, highest rank first.
   *
   * Sorted here rather than trusted from the server, because this is now the
   * thing an operator arranges directly: a list that came back in a different
   * order than it was dropped in would read as the drag having failed.
   */
  const orderedRoles = useMemo(
    () => byRank(state?.roles ?? []) as EditorState["roles"],
    [state?.roles],
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

  /**
   * Whether this server turns guests away at the door (GRYT-907).
   *
   * Only claimed when the server said which tiers it takes. A server too old to
   * send them answers undefined, and undefined is not "no" — switching the
   * control off on a guess would tell an operator their guest setting is dead
   * when it may be the thing letting people in.
   */
  const guestsRefused =
    !!state?.identityTiers && !state.identityTiers.includes("local");

  /**
   * Write one role, whole.
   *
   * The server's save event takes a role and everything about it, so every
   * commit below goes through here. `permissions` comes from the drafts because
   * the grid may have moved them since the server last spoke.
   */
  const saveRole = (role: RoleDefinition, roleId: string, permissions?: string[]) => {
    pendingSaves.current += 1;
    setSaving(true);
    emit("server:roles:definitions:save", {
      roleId,
      name: role.name,
      color: role.color,
      rank: role.rank,
      permissions: permissions ?? permDrafts[roleId] ?? role.permissions,
      autoGrantAfterDays: role.autoGrantAfterDays,
      autoGrantAfterMessages: role.autoGrantAfterMessages,
      grantableByInvite: role.grantableByInvite,
    });
  };

  /**
   * The owner role's colour, and only that (GRYT-906).
   *
   * Its own emit rather than `saveRole`, because the server's exception for the
   * owner requires every other field to be *absent* — a payload carrying a rank
   * beside the colour is refused whole. That is the right shape on the server,
   * and it means the seven-field save above cannot be reused here.
   */
  const saveOwnerColor = (color: string | null) => {
    pendingSaves.current += 1;
    setSaving(true);
    emit("server:roles:definitions:save", { roleId: OWNER_ROLE, color });
  };

  /**
   * Commit on the way out of whichever field was being edited, like every other
   * settings screen in Gryt. A Save button at the far end of a scrolling panel
   * put a batch of role edits in the bin.
   *
   * A role being created cannot commit on every blur — its id comes from its
   * name, so there is nothing to write until the name is there.
   */
  const commitSettings = (patch?: Partial<RoleDefinition>) => {
    if (!state || !draft) return;

    /*
     * A field that commits on blur has already told React about its change by
     * the time focus leaves it, so `draft` is current. A swatch does both in one
     * press — set the colour, then save — and `setDraft` has not landed when the
     * save runs: reading `draft` there gives the colour from before the press,
     * `dirty` comes back false, and the ring moves while the database does not.
     * So the caller hands over what it just set.
     */
    const next = patch ? { ...draft, ...patch } : draft;
    const changed = patch
      ? true
      : dirty;
    if (!changed && !creating) return;

    const roleId = creating ? slugify(next.name) : next.id;
    if (!roleId) return;

    if (creating) {
      if (state.roles.some((r) => r.id === roleId)) {
        toast.error(`There is already a role called "${next.name}".`);
        return;
      }
      setSelectedId(roleId);
    }

    saveRole(next, roleId);
  };

  /**
   * The other way out of a field: closing the dialog.
   *
   * Blur covers moving between fields and clicking another role. It does not
   * cover Escape or the X, because the input is unmounted rather than left. A
   * ref, because the effect has to run on unmount only and would otherwise
   * close over the first render's draft.
   */
  const commitRef = useRef(commitSettings);
  commitRef.current = commitSettings;
  useEffect(() => () => commitRef.current(), []);

  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  /**
   * Dropping a role somewhere writes the order back as ranks. **Spaced by
   * ten** — see `ranksAfterMove`. Owner keeps 100 and never moves, since the
   * server refuses to save it.
   */
  const handleReorder = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!state || !over) return;

    for (const role of ranksAfterMove(state.roles, String(active.id), String(over.id))) {
      const full = state.roles.find((r) => r.id === role.id);
      if (full) saveRole({ ...full, rank: role.rank }, role.id);
    }
  };

  const createRole = () => {
    // Held locally until it is saved, so the id can come from the name. Empty
    // and at the bottom: a new role that arrived with permissions already
    // ticked would be a role that did something before anybody looked at it.
    setSelectedId(NEW_ROLE);
    setDraft({
      id: NEW_ROLE,
      name: "",
      // A colour rather than none. A role with no colour draws its members'
      // names in the ordinary text colour, which is the same as every other
      // role that never got one — so the list stops telling them apart at
      // exactly the point somebody has bothered to make a second role.
      color: nextUnusedPreset((state?.roles ?? []).map((r) => r.color)),
      rank: 5,
      permissions: [],
      isSystem: false,
      autoGrantAfterDays: null,
      grantableByInvite: false,
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

  /**
   * A tick in the grid is a save, on the spot.
   *
   * The draft is still kept, because it is what the grid draws from and the
   * server's answer is a round trip away — without it the box a moment ago
   * un-ticks itself and then re-ticks when the reply lands.
   */
  const togglePermission = (roleId: string, permission: string, on: boolean) => {
    const role = state?.roles.find((r) => r.id === roleId);
    const current = permDrafts[roleId] ?? role?.permissions ?? [];
    const next = on
      ? current.includes(permission)
        ? current
        : [...current, permission]
      : current.filter((p) => p !== permission);

    if (role) saveRole(role, roleId, next);

    setPermDrafts((drafts) => {
      const current = drafts[roleId] ?? [];
      return {
        ...drafts,
        [roleId]: on
          ? current.includes(permission)
            ? current
            : [...current, permission]
          : current.filter((p) => p !== permission),
      };
    });
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
          <DndContext
            sensors={dragSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleReorder}
          >
            <SortableContext
              items={orderedRoles.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2">
                {orderedRoles.map((role) => (
                  <SortableRole key={role.id} id={role.id} disabled={role.id === OWNER_ROLE}>
            <button
              type="button"
              style={{ width: "100%" }}
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
                  </SortableRole>
                ))}
              </div>
            </SortableContext>
          </DndContext>

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
          ) : draft.id === OWNER_ROLE ? (
            /* Everything but the colour (GRYT-906). The server takes a
               colour-only save for this role and refuses the rest, so this
               panel offers exactly that and says why the rest is missing. */
            <div className="flex flex-col gap-4">
              <span className="text-sm text-gryt-muted">
                The owner holds every permission, and its name, rank and permissions cannot
                be changed. It is what the server falls back to if anything else here goes
                wrong, which is the only reason a mistake on this screen is recoverable.
              </span>

              <div className="flex flex-col gap-2">
                <span className="text-gryt-muted text-sm">Colour</span>
                <RoleColorField
                  value={draft.color}
                  onChange={(color) => setDraft({ ...draft, color })}
                  onCommit={(color) => saveOwnerColor(color)}
                />
                <span className="text-xs text-gryt-muted">
                  Colours the owner&rsquo;s name in the member list and in chat. It is the one
                  thing here that changes nothing about what the owner can do.
                </span>
              </div>
            </div>
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
                    onBlur={() => commitSettings()}
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

              <div className="flex flex-col gap-2">
                <span className="text-gryt-muted text-sm">Colour</span>
                <RoleColorField
                  value={draft.color}
                  onChange={(color) => setDraft({ ...draft, color })}
                  onCommit={(color) => commitSettings({ color })}
                />
              </div>


              {!draft.isSystem && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-3 text-sm font-bold">
                      <input
                        type="checkbox"
                        checked={draft.grantableByInvite}
                        disabled={draft.isSystem}
                        onChange={(e) => {
                          setDraft({ ...draft, grantableByInvite: e.target.checked });
                          commitSettings();
                        }}
                      />
                      Can be given out by an invite
                    </label>
                    <span className="text-xs text-gryt-muted">
                      Off unless you turn it on, for every role. With it on, an invite
                      can be bound to this role and whoever joins on that link arrives
                      holding it — which is only as private as the link is.{" "}
                      {draft.isSystem
                        ? "Built-in roles cannot be given out this way."
                        : "Admin and owner can never be given out this way, and neither can a role that can hand out permissions. Those are given by hand."}
                    </span>
                  </div>

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
                        onBlur={() => commitSettings()}
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
                        onBlur={() => commitSettings()}
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

              {/* Creating keeps a button, and only creating.
                  Editing an existing role commits as you go, because every
                  field there is a change to something that already exists. A
                  new role is not that: it does not exist until it is made, its
                  id is minted from the name and cannot be changed afterwards,
                  and "it saved itself while I was still deciding what to call
                  it" is a worse surprise than one press. */}
              {creating && (
                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    disabled={!slugify(draft.name) || saving}
                    onClick={() => commitSettings()}
                  >
                    Create role
                  </Button>
                  <span className="text-xs text-gryt-muted">
                    {slugify(draft.name)
                      ? "Everything after this saves as you edit it."
                      : "Give it a name first."}
                  </span>
                </div>
              )}
            </div>
          )}
        </Surface>
      </div>

      <Surface>
        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex flex-col">
            <span className="text-sm font-bold">What each role may do</span>
            <span className="text-xs text-gryt-muted">
              Every role at once. A column is a role, a row is a permission, and rank
              orders the columns. On a narrow window this becomes one role at a time,
              each showing what it adds to the rank below it.
            </span>
          </div>

          <RolePermissionGrid
            roles={gridRoles}
            catalogue={state.permissions}
            onToggle={togglePermission}
            readOnlyRoleIds={READ_ONLY_ROLES}
          />
        </div>
      </Surface>

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
                disabled={guestsRefused}
              />
              {/* Where the answer is known, it replaces the footnote below
                  rather than joining it. A live control with a note underneath
                  explaining it does nothing is the thing this fixes. */}
              {guestsRefused && (
                <span className="text-xs text-gryt-muted" style={{ maxWidth: 260 }}>
                  No guests are allowed on this server, so this is never used.
                </span>
              )}
            </label>
          </div>

          {/* Only where the server did not say. A server too old to send its
              tiers leaves this exactly as it was — the note is the best that
              can be offered when the answer is unknown. */}
          {state.identityTiers === undefined && (
            <span className="text-xs text-gryt-muted">
              Guests only reach this server at all if it accepts self-signed identities —
              GRYT_IDENTITY_TIERS on the server. Where it does not, the guest default is
              never used.
            </span>
          )}
        </div>
      </Surface>
    </div>
  );
}
