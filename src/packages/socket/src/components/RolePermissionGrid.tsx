import { Checkbox, Select, TextField, Tooltip } from "@gryt/ui";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { PiInfoBold, PiMagnifyingGlassBold } from "../../../../lib/icons";
import { hasRoomForPermissionMatrix } from "../lib/permissionGridLayout";
import { groupPermissions, type PermissionMeta } from "../lib/permissions";

export type GridRole = {
  id: string;
  name: string;
  color: string | null;
  rank: number;
  permissions: string[];
};

/**
 * The permissions that take something away from somebody rather than let the
 * holder do more. Presentation only — the server has one flat list.
 */
const DESTRUCTIVE = new Set([
  "replace_identity",
  "manage_roles",
  "manage_server",
  "ban_members",
  "manage_bots",
]);

/**
 * The container's width, watched rather than read once. Both sources are needed:
 * ancestors with `overflow-x: auto` let content overflow without an observation.
 */
function useContainerWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return [ref, width];
}

function matches(permission: PermissionMeta, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    permission.label.toLowerCase().includes(q) ||
    permission.id.toLowerCase().includes(q) ||
    permission.description.toLowerCase().includes(q)
  );
}

function RoleDot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        flexShrink: 0,
        background: color || "var(--gryt-muted, #888)",
      }}
    />
  );
}

function PermissionName({ permission }: { permission: PermissionMeta }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="truncate">{permission.label}</span>
      {permission.description && (
        <Tooltip title={permission.description}>
          <span className="text-gryt-muted shrink-0 cursor-help" tabIndex={0}>
            <PiInfoBold size={12} aria-label={`About ${permission.label}`} />
          </span>
        </Tooltip>
      )}
    </span>
  );
}

/**
 * Every role's permissions at once — roles across, permissions down. Below
 * `hasRoomForPermissionMatrix` the same state draws as a ladder instead.
 */
export function RolePermissionGrid({
  roles,
  catalogue,
  onToggle,
  readOnlyRoleIds,
}: {
  roles: GridRole[];
  /** The permission ids this server knows about, in the server's order. */
  catalogue: string[];
  onToggle: (roleId: string, permission: string, on: boolean) => void;
  /** Roles the server refuses to save — drawn, but not editable. */
  readOnlyRoleIds: Set<string>;
}) {
  const [containerRef, width] = useContainerWidth();
  const [query, setQuery] = useState("");
  const [compare, setCompare] = useState(false);
  const [left, setLeft] = useState<string>("");
  const [right, setRight] = useState<string>("");

  const groups = useMemo(() => groupPermissions(catalogue), [catalogue]);

  // Default the comparison to the two adjacent ranks somebody is most likely to
  // be deciding between — the pair with the smallest gap between them.
  useEffect(() => {
    if (left && right) return;
    const editable = [...roles]
      .filter((r) => !readOnlyRoleIds.has(r.id))
      .sort((a, b) => a.rank - b.rank);
    if (editable.length < 2) return;
    let best = 0;
    for (let i = 1; i < editable.length - 1; i++) {
      if (editable[i + 1].rank - editable[i].rank < editable[best + 1].rank - editable[best].rank) {
        best = i;
      }
    }
    setLeft((v) => v || editable[best].id);
    setRight((v) => v || editable[best + 1].id);
  }, [roles, readOnlyRoleIds, left, right]);

  const held = useMemo(
    () => Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions)])),
    [roles],
  );

  const visibleGroups = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          permissions: group.permissions.filter((permission) => {
            if (!matches(permission, query)) return false;
            if (compare && left && right) {
              return held[left]?.has(permission.id) !== held[right]?.has(permission.id);
            }
            return true;
          }),
        }))
        .filter((group) => group.permissions.length > 0),
    [groups, query, compare, left, right, held],
  );

  const shown = visibleGroups.reduce((n, g) => n + g.permissions.length, 0);
  const asMatrix = hasRoomForPermissionMatrix({ containerWidth: width, roleCount: roles.length });
  const roleOptions = roles.map((r) => ({ label: r.name, value: r.id }));

  return (
    // min-w-0 is load-bearing: a flex child defaults to `min-width: auto`, so the
    // container never shrinks below about 450px and the phone fallback never fires.
    <div ref={containerRef} className="flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1" style={{ minWidth: 180 }}>
          <PiMagnifyingGlassBold size={14} className="text-gryt-muted shrink-0" />
          <TextField
            size="small"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter permissions"
            aria-label="Filter permissions"
            className="w-full"
          />
        </div>

        {asMatrix && roles.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-gryt-muted shrink-0">
            <Checkbox
              checked={compare}
              onCheckedChange={(on: boolean) => setCompare(on)}
              aria-label="Show only permissions where two roles differ"
            />
            <span className="whitespace-nowrap">Only where</span>
            <Select
              size="small"
              value={left}
              onValueChange={(v) => {
                setLeft(String(v));
                setCompare(true);
              }}
              options={roleOptions}
            />
            <span className="whitespace-nowrap">differs from</span>
            <Select
              size="small"
              value={right}
              onValueChange={(v) => {
                setRight(String(v));
                setCompare(true);
              }}
              options={roleOptions}
            />
          </label>
        )}

        <span className="text-xs text-gryt-muted shrink-0">
          {compare ? `${shown} differ` : `${shown} of ${catalogue.length}`}
        </span>
      </div>

      {shown === 0 ? (
        <span className="text-sm text-gryt-muted py-6 text-center">
          {compare
            ? "Those two roles have exactly the same permissions."
            : "No permission matches that."}
        </span>
      ) : asMatrix ? (
        <PermissionMatrix
          groups={visibleGroups}
          roles={roles}
          held={held}
          onToggle={onToggle}
          readOnlyRoleIds={readOnlyRoleIds}
          highlight={compare ? [left, right] : []}
        />
      ) : (
        <PermissionLadder
          groups={visibleGroups}
          roles={roles}
          held={held}
          onToggle={onToggle}
          readOnlyRoleIds={readOnlyRoleIds}
        />
      )}
    </div>
  );
}

type ViewProps = {
  groups: { title: string; description: string; permissions: PermissionMeta[] }[];
  roles: GridRole[];
  held: Record<string, Set<string>>;
  onToggle: (roleId: string, permission: string, on: boolean) => void;
  readOnlyRoleIds: Set<string>;
};

/** Roles across, permissions down. */
function PermissionMatrix({
  groups,
  roles,
  held,
  onToggle,
  readOnlyRoleIds,
  highlight,
}: ViewProps & { highlight: string[] }) {
  const highlighted = new Set(highlight.filter(Boolean));

  return (
    // The grid is the one thing here allowed to scroll sideways; the panel
    // around it must not, so the overflow lives on this container.
    <div className="overflow-x-auto rounded-(--gryt-radius-md) border border-gryt-border">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Permissions by role. Each column is a role, each row a permission.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-2 bg-gryt-surface-raised text-left font-bold text-xs px-3 py-2"
              style={{ minWidth: 220 }}
            >
              Permission
            </th>
            {roles.map((role) => (
              <th
                key={role.id}
                scope="col"
                className={`bg-gryt-surface-raised px-1 py-2 text-center align-bottom ${
                  highlighted.has(role.id) ? "bg-gryt-accent/10" : ""
                }`}
                style={{ width: 76 }}
              >
                <span className="flex flex-col items-center gap-1">
                  <RoleDot color={role.color} />
                  <span className="text-xs font-bold leading-tight">{role.name}</span>
                  <span className="text-[10px] text-gryt-muted tabular-nums">{role.rank}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.title}>
              <tr>
                <th
                  scope="rowgroup"
                  colSpan={roles.length + 1}
                  className="bg-gryt-surface-raised text-left text-xs font-bold uppercase tracking-wide text-gryt-muted px-3 py-1.5"
                >
                  {group.title}
                </th>
              </tr>
              {group.permissions.map((permission) => (
                <tr
                  key={permission.id}
                  className="border-t border-gryt-border/50 hover:bg-gryt-surface-hover"
                  style={
                    DESTRUCTIVE.has(permission.id)
                      ? { boxShadow: "inset 3px 0 0 var(--gryt-danger)" }
                      : undefined
                  }
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-1 bg-gryt-surface text-left font-normal px-3 py-1.5"
                  >
                    <PermissionName permission={permission} />
                  </th>
                  {roles.map((role) => {
                    const locked = readOnlyRoleIds.has(role.id);
                    return (
                      <td
                        key={role.id}
                        className={`px-1 py-1.5 ${
                          highlighted.has(role.id) ? "bg-gryt-accent/10" : ""
                        }`}
                      >
                        {/* A flex row rather than `text-center` on the cell.
                            The checkbox is a block with its own width, so text
                            alignment never moved it: every box sat 24px left of
                            the column it belongs to while the header above it
                            was centred, which is what made the grid look out
                            of true. Measured, not guessed — cell centre 933,
                            box centre 909, in every column. */}
                        <div className="flex justify-center">
                          <Checkbox
                            checked={held[role.id]?.has(permission.id) ?? false}
                            disabled={locked}
                            tone={DESTRUCTIVE.has(permission.id) ? "danger" : undefined}
                            onCheckedChange={(on: boolean) => onToggle(role.id, permission.id, on)}
                            aria-label={`${permission.label} for ${role.name}`}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The same state, one role at a time, for a container too narrow for a grid. Each
 * role shows only what it adds to the rank below it, which is what a role is.
 */
function PermissionLadder({ groups, roles, held, onToggle, readOnlyRoleIds }: ViewProps) {
  const visible = new Set(groups.flatMap((g) => g.permissions.map((p) => p.id)));
  const meta = Object.fromEntries(
    groups.flatMap((g) => g.permissions.map((p) => [p.id, p] as const)),
  );
  const ordered = [...roles].sort((a, b) => a.rank - b.rank);

  return (
    <div className="flex flex-col">
      {ordered.map((role, i) => {
        const below = i > 0 ? ordered[i - 1] : null;
        const mine = held[role.id] ?? new Set<string>();
        const theirs = below ? (held[below.id] ?? new Set<string>()) : new Set<string>();
        const added = [...mine].filter((p) => visible.has(p) && !theirs.has(p));
        const removed = below ? [...theirs].filter((p) => visible.has(p) && !mine.has(p)) : [];
        const locked = readOnlyRoleIds.has(role.id);

        return (
          <div
            key={role.id}
            className="flex flex-col gap-2 py-3 border-t border-gryt-border first:border-t-0"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <RoleDot color={role.color} />
              <span className="text-sm font-bold">{role.name}</span>
              <span className="text-xs text-gryt-muted tabular-nums">rank {role.rank}</span>
              <span className="text-xs text-gryt-muted ml-auto tabular-nums">
                {mine.size} {mine.size === 1 ? "permission" : "permissions"}
              </span>
            </div>

            <span className="text-xs text-gryt-muted">
              {below ? (
                <>
                  Everything <b className="text-gryt-text font-medium">{below.name}</b> has
                  {added.length ? ", and:" : " — and nothing more."}
                </>
              ) : (
                "The floor. Somebody with no role at all."
              )}
            </span>

            {added.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {added.map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={locked}
                    onClick={() => onToggle(role.id, id, false)}
                    title={locked ? undefined : `Remove from ${role.name}`}
                    className={`flex items-center gap-1.5 rounded-(--gryt-radius-sm) border px-2 py-1 text-xs ${
                      DESTRUCTIVE.has(id)
                        ? "border-gryt-danger/40 text-gryt-danger"
                        : "border-gryt-border"
                    } ${locked ? "opacity-60" : "hover:bg-gryt-surface-hover"}`}
                  >
                    {meta[id]?.label ?? id}
                    {!locked && (
                      <span aria-hidden className="text-gryt-muted">
                        ×
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {removed.length > 0 && (
              <span className="text-xs text-gryt-muted">
                Takes away:{" "}
                <b className="text-gryt-text font-medium">
                  {removed.map((id) => meta[id]?.label ?? id).join(", ")}
                </b>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
