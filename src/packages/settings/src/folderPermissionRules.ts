import type { ChannelRule } from "./channelPermissionRules";

/** The folder's half of `describeRules`: reading denied here hides the folder
    along with every channel in it that follows it. */
export function describeFolderRules(
  rules: ChannelRule[],
  roleNames: Map<string, string>,
): string {
  if (rules.length === 0) return "Everyone on the server can see and use the channels in this folder.";

  const hidden = rules
    .filter((r) => r.permission === "read_messages" && r.effect === "deny")
    .map((r) => roleNames.get(r.roleId) ?? r.roleId);
  const others = rules.filter((r) => r.permission !== "read_messages").length;

  if (hidden.length === 0) {
    return `${others} change${others === 1 ? "" : "s"} to what roles can do in this folder's channels.`;
  }

  const list =
    hidden.length === 1
      ? hidden[0]
      : `${hidden.slice(0, -1).join(", ")} and ${hidden[hidden.length - 1]}`;
  const rest = others > 0 ? `, and ${others} other change${others === 1 ? "" : "s"}` : "";
  return `${list} won't see this folder or anything in it${rest}.`;
}

/** The picker's value for "whatever the folder says". A word, since "" paints the placeholder. */
export const FOLLOW_FOLDER_VALUE = "follow-folder";

/** The first option in a folder's channel's picker. */
export function followFolderLabel(folderName: string | null): string {
  return folderName ? `Follow the ${folderName} folder` : "Follow folder";
}

/** The line above a channel's permissions once it has its own instead of its folder's. */
export function folderFollowNote(folderName: string | null): string {
  const folder = folderName ? `the ${folderName} folder` : "its folder";
  return `Has its own permissions instead of ${folder}'s.`;
}

/** The sentence under the picker while a channel follows its folder. `templateName`
    is set when the folder uses a template, and then its rules are not the point. */
export function followingFolderDescription(
  folderName: string | null,
  rules: ChannelRule[],
  roleNames: Map<string, string>,
  templateName: string | null,
): string {
  const folder = folderName ? `The ${folderName} folder` : "Its folder";
  const lead = `${folder} decides who can use this channel.`;
  if (templateName) return `${lead} It uses the ${templateName} template.`;
  return `${lead} ${describeFolderRules(rules, roleNames)}`;
}

/** What a channel's own scope looks like from `server:channels`, which only `manage_channels` gets. */
export interface ChannelScopeState {
  /** The scope it resolves to: its folder's while it follows one. */
  permissionScopeId: string | null;
  /** Absent on a server too old to send it. */
  followsFolder?: boolean;
}

/** Moving a channel into another folder: "follow" when it has no permissions of its own,
    "ask" when it has, "none" when there is nothing to decide or too little known. */
export function folderMoveAction(
  fromFolderId: string | null,
  toFolderId: string | null,
  scope: ChannelScopeState | undefined,
): "none" | "follow" | "ask" {
  if (!toFolderId || toFolderId === fromFolderId) return "none";
  if (!scope || scope.followsFolder === undefined) return "none";
  // Following one folder already means following the next.
  if (fromFolderId) return scope.followsFolder ? "none" : "ask";
  return scope.permissionScopeId ? "ask" : "follow";
}
