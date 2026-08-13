import { ContextMenu, Slider } from "@gryt/ui";
import { ReactNode } from "react";
import toast from "react-hot-toast";
import { PiAtFill, PiCopyFill } from "react-icons/pi";

import { useSettings } from "@/settings";

type Role = "owner" | "admin" | "mod" | "member";

interface UserContextMenuProps {
  children: ReactNode;
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
}

const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, mod: 2, member: 1 };

function canTarget(actorRole?: Role, targetRole?: Role): boolean {
  if (!actorRole || !targetRole) return false;
  return ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

export function UserContextMenu({
  children,
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
}: UserContextMenuProps) {
  const { userVolumes, updateUserVolume, resetUserVolume, openSettings } = useSettings();

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
  // Two floors, matching the server. Kick, mute and deafen are reversible and
  // start at mod; ban is not, and stays at admin. `mod` used to be excluded
  // from both by an isAdmin check that ignored the ROLE_RANK table right above
  // it, which is why the role was assignable and did nothing.
  const outranksTarget = canTarget(role, targetRole);
  const canModerate = !!role && ROLE_RANK[role] >= ROLE_RANK.mod && outranksTarget;
  const canBan = !!role && ROLE_RANK[role] >= ROLE_RANK.admin && outranksTarget;

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
            <span className="text-xs text-gryt-muted" style={{ textTransform: "capitalize" }}>{targetRole}</span>
          </div>
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

            {onServerMute && (
              <ContextMenu.Item onClick={() => onServerMute(!isServerMuted)}>
                {isServerMuted ? "Remove server mute" : "Server mute"}
              </ContextMenu.Item>
            )}

            {onServerDeafen && (
              <ContextMenu.Item onClick={() => onServerDeafen(!isServerDeafened)}>
                {isServerDeafened ? "Remove server deafen" : "Server deafen"}
              </ContextMenu.Item>
            )}

            {role === "owner" && onChangeRole && (
              <ContextMenu.SubmenuRoot>
                <ContextMenu.SubmenuTrigger>Change role</ContextMenu.SubmenuTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.Positioner>
                    <ContextMenu.Popup>
                  {(["admin", "mod", "member"] as Role[]).map((r) => (
                    <ContextMenu.Item
                      key={r}
                      disabled={targetRole === r}
                      onClick={() => onChangeRole(r)}
                      style={{ textTransform: "capitalize" }}
                    >
                      {r}{targetRole === r ? " (current)" : ""}
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              </ContextMenu.SubmenuRoot>
            )}

            <ContextMenu.Separator />

            {onKick && (
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
