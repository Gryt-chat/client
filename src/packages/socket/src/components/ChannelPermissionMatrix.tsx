import { Tooltip } from "@gryt/ui";

import {
  type CellState,
  cellState,
  type ChannelRule,
  indexRules,
  nextCellState,
  withCell,
} from "@/settings/src/channelPermissionRules";

import { describePermission } from "../lib/permissions";
import { PermissionCell } from "./PermissionCell";

/**
 * What one channel changes, per role. Not `RolePermissionGrid`: three states
 * rather than two, and the middle one has to say what it is inheriting.
 */

const CELL_LABEL: Record<CellState, string> = {
  inherit: "Inherits from the role",
  allow: "Allowed here, even if the role cannot elsewhere",
  deny: "Denied here, even if the role can elsewhere",
};

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
                      <PermissionCell
                        state={state}
                        inherited={inherited}
                        disabled={disabled}
                        aria-label={`${describePermission(permission).label} for ${role.name}: ${state}`}
                        onClick={() =>
                          onChange(withCell(rules, role.id, permission, nextCellState(state)))
                        }
                      />
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
