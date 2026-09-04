import { Tooltip } from "@gryt/ui";

import {
  type CellState,
  cellState,
  type ChannelRule,
  indexRules,
  nextCellState,
  withCell,
} from "@/settings/src/channelPermissionRules";

import { PiCheckBold, PiMinusBold, PiProhibitBold } from "../../../../lib/icons";
import { describePermission } from "../lib/permissions";

/**
 * What one channel changes, per role.
 *
 * Deliberately not `RolePermissionGrid`. That one draws whether a role holds a
 * permission, which is on or off. This draws whether a channel *changes* it,
 * which is three states, and the middle one has to say what it is inheriting —
 * a blank cell would mean both "allowed everywhere" and "denied everywhere"
 * depending on the role, which is what somebody opens this to find out.
 *
 * Roles across and permissions down, matching the role editor.
 */

const CELL_LABEL: Record<CellState, string> = {
  inherit: "Inherits from the role",
  allow: "Allowed here, even if the role cannot elsewhere",
  deny: "Denied here, even if the role can elsewhere",
};

function CellIcon({ state, inherited }: { state: CellState; inherited: boolean }) {
  if (state === "allow") return <PiCheckBold size={13} aria-hidden />;
  if (state === "deny") return <PiProhibitBold size={13} aria-hidden />;
  // Inheriting. The icon shows what it inherits rather than nothing, so a
  // column of grey ticks reads as "this role can already do all of these".
  return (
    <span className="opacity-40">
      {inherited ? <PiCheckBold size={13} aria-hidden /> : <PiMinusBold size={13} aria-hidden />}
    </span>
  );
}

export function ChannelPermissionMatrix({
  roles,
  permissions,
  rules,
  onChange,
  disabled,
}: {
  roles: { id: string; name: string; rank: number; permissions: string[] }[];
  /** The permissions this server will scope, in the server's order. */
  permissions: string[];
  rules: ChannelRule[];
  onChange: (next: ChannelRule[]) => void;
  disabled?: boolean;
}) {
  const index = indexRules(rules);
  // Low rank first, so the columns run from the people a channel is usually
  // being closed to towards the people it is being kept open for.
  const ordered = [...roles].sort((a, b) => a.rank - b.rank);

  if (ordered.length === 0 || permissions.length === 0) {
    return <span className="text-xs">This server has no roles to set permissions for yet.</span>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-inherit p-1 text-left font-medium">Permission</th>
            {ordered.map((role) => (
              <th key={role.id} className="p-1 text-center font-medium">
                {role.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {permissions.map((permission) => (
            <tr key={permission}>
              <td className="sticky left-0 z-10 bg-inherit p-1 whitespace-nowrap">
                {describePermission(permission).label}
              </td>
              {ordered.map((role) => {
                const state = cellState(index, role.id, permission);
                const inherited = role.permissions.includes(permission);
                return (
                  <td key={role.id} className="p-1 text-center">
                    <Tooltip title={CELL_LABEL[state]}>
                      <button
                        type="button"
                        disabled={disabled}
                        aria-label={`${describePermission(permission).label} for ${role.name}: ${state}`}
                        data-state={state}
                        className="inline-flex h-6 w-6 items-center justify-center rounded"
                        onClick={() =>
                          onChange(withCell(rules, role.id, permission, nextCellState(state)))
                        }
                      >
                        <CellIcon state={state} inherited={inherited} />
                      </button>
                    </Tooltip>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
