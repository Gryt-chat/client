import { useState } from "react";

import type { ChannelRule } from "@/settings/src/channelPermissionRules";

import { useFrame } from "./stage";
import { ChannelPermissionMatrix } from "../packages/socket/src/components/ChannelPermissionMatrix";
import { ServerRoleEditorTab } from "../packages/socket/src/components/ServerRoleEditorTab";

const SERVER_PERMS = ["send_messages", "attach_files", "add_reactions", "join_voice", "speak", "share_screen", "manage_messages", "kick_members"];
const CHANNEL_PERMS = ["read_messages", "send_messages", "attach_files", "add_reactions"];

type Role = {
  id: string; name: string; color: string | null; rank: number; permissions: string[]; isSystem: boolean;
  autoGrantAfterDays: number | null; autoGrantAfterMessages: number | null; grantableByInvite: boolean; mentionable?: boolean; memberCount: number;
};

const role = (id: string, name: string, rank: number, color: string | null, permissions: string[], memberCount: number): Role => ({
  id, name, color, rank, permissions, isSystem: id === "owner" || id === "member", autoGrantAfterDays: null,
  autoGrantAfterMessages: null, grantableByInvite: false, memberCount,
});

export const roles: Role[] = [
  role("owner", "Owner", 100, "#968ff8", SERVER_PERMS, 1),
  role("member", "Member", 0, null, ["send_messages", "add_reactions", "join_voice", "speak"], 0),
];

/** Stands in for the server's role events: keeps the list in memory and answers like it would. */
function roleSocket() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const send = (event: string, payload: unknown) => setTimeout(() => handlers.get(event)?.forEach((h) => h(payload)), 0);
  const list = () => send("server:roles:definitions", { roles: roles.map((r) => ({ ...r })), permissions: SERVER_PERMS, defaults: { account: "member", local: "member" } });
  return {
    connected: true,
    emit: (event: string, p: Partial<Role> & { roleId?: string }) => {
      if (event === "server:roles:definitions:list") list();
      if (event === "server:roles:definitions:save" && p.roleId) {
        const at = roles.findIndex((r) => r.id === p.roleId);
        const next = { ...(at >= 0 ? roles[at] : role(p.roleId, p.name ?? p.roleId, p.rank ?? 5, null, [], 0)), ...p, id: p.roleId };
        if (at >= 0) roles[at] = next as Role; else roles.push(next as Role);
        send("server:roles:definition:updated", { roleId: p.roleId });
      }
    },
    on: (event: string, h: (p: unknown) => void) => { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(h); },
    off: (event: string, h: (p: unknown) => void) => handlers.get(event)?.delete(h),
  };
}

const socket = roleSocket();

export function RoleEditor() {
  return <ServerRoleEditorTab host="motion.gryt" socket={socket as never} accessToken="motion" />;
}

export function FolderPermissions() {
  useFrame();
  const [rules, setRules] = useState<ChannelRule[]>([]);
  return (
    <ChannelPermissionMatrix
      roles={roles.filter((r) => r.id !== "owner")} permissions={CHANNEL_PERMS} rules={rules} onChange={setRules}
    />
  );
}
