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

/** The line above a channel's permissions while it sits in a folder. */
export function folderFollowNote(folderName: string | null, followsFolder: boolean): string {
  const folder = folderName ? `the ${folderName} folder` : "its folder";
  return followsFolder
    ? `Follows ${folder}. Pick something here to give this channel its own permissions.`
    : `Has its own permissions instead of ${folder}'s.`;
}
