import { ContextMenu, Slider } from "@gryt/ui";
import { ReactNode } from "react";
import toast from "react-hot-toast";
import { PiAtFill, PiChatCircleFill, PiCopyFill, PiProhibitFill } from "react-icons/pi";

import { useSettings } from "@/settings";

import { useServerPermissions } from "../hooks/usePermissions";

/** A role id. The server defines what they are; this only passes them around. */
type Role = string;

interface UserContextMenuProps {
  children: ReactNode;
  /**
   * Which server this menu belongs to, so the permissions and the role list
   * can be looked up rather than assumed.
   *
   * Optional because two callers render this outside a server view. Without it
   * the menu falls back to the built-in ladder, which is what it did before
   * roles were editable — wrong for a custom role, and never wrong in the
   * direction of offering something the server would refuse, since the built-in
   * ranks are the highest any custom role can be given.
   */
  serverHost?: string;
  serverUserId?: string;
  nickname: string;
  isSelf?: boolean;
  canDisconnect?: boolean;
  isInVoice?: boolean;
  onDisconnectFromVoice?: () => void;
  role?: Role;
  targetRole?: Role;
  isServerMuted?: boolean;
  isServerDeafened?: boolean;
  onKick?: () => void;
  onBan?: () => void;
  onServerMute?: (muted: boolean) => void;
  onServerDeafen?: (deafened: boolean) => void;
  onChangeRole?: (role: Role) => void;
  onPopoutVideo?: () => void;
  /**
   * Open a direct message with this person, on this server.
   *
   * Absent when the menu is rendered outside a server view, and on a server
   * old enough not to have the events. The item is left out rather than
   * shown and refused.
   */
  onOpenDm?: () => void;
  /**
   * Stop hearing from this person, or start again.
   *
   * Deliberately outside the moderator section below. Blocking needs no
   * permission and has to work against somebody who outranks you, which is the
   * whole difference between it and a kick.
   *
   * Absent when the menu is rendered outside a server view, and on a server old
   * enough not to have the events.
   */
  onToggleBlock?: () => void;
  isBlocked?: boolean;
}

/**
 * The ranks the built-in roles ship with, for a server that has not told us
 * otherwise — one that predates editable roles, or a menu rendered where the
 * host is not known.
 */
const BUILT_IN_RANK: Record<string, number> = {
  owner: 100,
  admin: 80,
  mod: 60,
  member: 40,
  guest: 10,
};

export function UserContextMenu({
  children,
  serverHost,
  serverUserId,
  nickname,
  isSelf,
  canDisconnect,
  isInVoice,
  onDisconnectFromVoice,
  role,
  targetRole,
  isServerMuted,
  isServerDeafened,
  onKick,
  onBan,
  onServerMute,
  onServerDeafen,
  onChangeRole,
  onPopoutVideo,
  onOpenDm,
  onToggleBlock,
  isBlocked,
}: UserContextMenuProps) {
  const { userVolumes, updateUserVolume, resetUserVolume, openSettings } = useSettings();
  const { has, can, roles } = useServerPermissions(serverHost || "");

  const handleCopyId = () => {
    if (!serverUserId) return;
    navigator.clipboard.writeText(serverUserId).then(
      () => toast.success("Copied user ID"),
      () => toast.error("Failed to copy"),
    );
  };

  const handleMention = () => {
    if (!serverUserId) return;
    window.dispatchEvent(
      new CustomEvent("mention_user", {
        detail: { serverUserId, nickname },
      }),
    );
  };

  if (isSelf) {
    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger style={{ display: "contents" }}>{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup className="min-w-45">
          {/* The label names a group, and Base UI reads the group's id off
              context to point aria-labelledby at it. Without one it throws —
              which is what took the app down on a right-click. */}
          <ContextMenu.Group>
            <ContextMenu.GroupLabel style={{ fontWeight: "bold" }}>
              {nickname}
            </ContextMenu.GroupLabel>
          </ContextMenu.Group>
          <ContextMenu.Separator />
          <ContextMenu.Item onClick={() => openSettings("profile")}>
            Edit Profile
          </ContextMenu.Item>
          {serverUserId && (
            <ContextMenu.Item onClick={handleCopyId}>
              <div className="flex items-center gap-2">
                <PiCopyFill size={14} /> Copy ID
              </div>
            </ContextMenu.Item>
          )}
          {onPopoutVideo && (
            <>
              <ContextMenu.Separator />
              <ContextMenu.Item onClick={onPopoutVideo}>
                Pop out video
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
    );
  }

  if (!serverUserId) {
    return <>{children}</>;
  }

  const volume = userVolumes[serverUserId] ?? 100;
  const showDisconnect = canDisconnect && isInVoice && onDisconnectFromVoice;

  const rankOf = (roleId?: string) =>
    (roleId ? roles.find((r) => r.id === roleId)?.rank ?? BUILT_IN_RANK[roleId] : undefined) ?? -1;

  // Rank decides who may be acted on; permissions decide what the action is.
  // They used to be the same question asked of a four-rung ladder, which is why
  // a role built to do exactly one of these things could not be expressed.
  const outranksTarget = !!role && !!targetRole && rankOf(role) > rankOf(targetRole);
  const canMute = has("mute_members") && outranksTarget;
  const canDeafen = has("deafen_members") && outranksTarget;
  const canKick = has("kick_members") && outranksTarget;
  const canBan = has("ban_members") && outranksTarget;
  const canAssignRoles = has("manage_roles") && outranksTarget;
  const canModerate = canMute || canDeafen || canKick || canBan || canAssignRoles;

  // Only roles this person could actually hand out. Offering one the server
  // would refuse is offering a click that ends in a red toast.
  const assignableRoles = roles
    .filter((r) => r.id !== "owner" && r.rank < rankOf(role))
    .sort((a, b) => b.rank - a.rank);

  const targetRoleName = targetRole
    ? roles.find((r) => r.id === targetRole)?.name ?? targetRole
    : null;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger style={{ display: "contents" }}>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup className="min-w-55">
        <ContextMenu.Group>
          <ContextMenu.GroupLabel style={{ fontWeight: "bold" }}>
            {nickname}
          </ContextMenu.GroupLabel>
        </ContextMenu.Group>
        {targetRole && (
          // A subtitle rather than a second heading: one group, one label.
          <div className="px-3 pb-1">
            <span className="text-xs text-gryt-muted">{targetRoleName}</span>
          </div>
        )}
        {/* `can` rather than `has`: a server from before `send_direct_messages`
            existed does not list it anywhere, and asking `has` there hides the
            item on every server where DMs work perfectly well. `can` answers
            true for a permission the server has never heard of, so only a
            server that knows the permission and withheld it loses the item. */}
        {onOpenDm && can("send_direct_messages") && (
          <ContextMenu.Item onClick={onOpenDm}>
            <div className="flex items-center gap-2">
              <PiChatCircleFill size={14} /> Message
            </div>
          </ContextMenu.Item>
        )}
        <ContextMenu.Item onClick={handleMention}>
          <div className="flex items-center gap-2">
            <PiAtFill size={14} /> Mention
          </div>
        </ContextMenu.Item>
        <ContextMenu.Item onClick={handleCopyId}>
          <div className="flex items-center gap-2">
            <PiCopyFill size={14} /> Copy ID
          </div>
        </ContextMenu.Item>
        {/* Above the volume slider and well above the moderator section, which
            is where it belongs on both counts: it is something anybody can do
            to anybody, and it is not a moderator act however much it looks like
            one. No permission is asked for, because a block that needed a role
            would not work for the person who needs it most.

            Unblocking is not in the danger colour. It only ever gives back. */}
        {onToggleBlock && (
          <ContextMenu.Item
            className={isBlocked ? undefined : "text-gryt-danger"}
            onClick={onToggleBlock}
          >
            <div className="flex items-center gap-2">
              <PiProhibitFill size={14} /> {isBlocked ? "Unblock" : "Block"}
            </div>
          </ContextMenu.Item>
        )}
        <ContextMenu.Separator />
        <div className="flex flex-col gap-2 px-2 py-1" onPointerDown={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gryt-muted">Volume</span>
            <span className="text-xs font-medium" style={{ fontVariantNumeric: "tabular-nums" }}>
              {volume}%
            </span>
          </div>
          <Slider
            min={0}
            max={200}
            step={1}
            value={volume}
            onValueChange={(next) => updateUserVolume(serverUserId, Number(next))}
          />
        </div>
        {volume !== 100 && (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => resetUserVolume(serverUserId)}>
              Reset volume
            </ContextMenu.Item>
          </>
        )}
        {onPopoutVideo && (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={onPopoutVideo}>
              Pop out video
            </ContextMenu.Item>
          </>
        )}
        {showDisconnect && (
          <>
            <ContextMenu.Separator />
            <ContextMenu.Item className="text-gryt-danger" onClick={onDisconnectFromVoice}>
              Disconnect from voice
            </ContextMenu.Item>
          </>
        )}

        {canModerate && (
          <>
            <ContextMenu.Separator />

            {canMute && onServerMute && (
              <ContextMenu.Item onClick={() => onServerMute(!isServerMuted)}>
                {isServerMuted ? "Remove server mute" : "Server mute"}
              </ContextMenu.Item>
            )}

            {canDeafen && onServerDeafen && (
              <ContextMenu.Item onClick={() => onServerDeafen(!isServerDeafened)}>
                {isServerDeafened ? "Remove server deafen" : "Server deafen"}
              </ContextMenu.Item>
            )}

            {canAssignRoles && onChangeRole && assignableRoles.length > 0 && (
              <ContextMenu.SubmenuRoot>
                <ContextMenu.SubmenuTrigger>Change role</ContextMenu.SubmenuTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.Positioner>
                    <ContextMenu.Popup>
                  {assignableRoles.map((r) => (
                    <ContextMenu.Item
                      key={r.id}
                      disabled={targetRole === r.id}
                      onClick={() => onChangeRole(r.id)}
                    >
                      {r.name}{targetRole === r.id ? " (current)" : ""}
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              </ContextMenu.SubmenuRoot>
            )}

            <ContextMenu.Separator />

            {canKick && onKick && (
              <ContextMenu.Item className="text-gryt-danger" onClick={onKick}>
                Kick from server
              </ContextMenu.Item>
            )}

            {canBan && onBan && (
              <ContextMenu.Item className="text-gryt-danger" onClick={onBan}>
                Ban from server
              </ContextMenu.Item>
            )}
          </>
        )}
      </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
