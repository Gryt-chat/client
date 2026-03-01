import { ContextMenu, Flex, Slider, Text } from "@radix-ui/themes";
import { ReactNode } from "react";
import toast from "react-hot-toast";
import { MdAlternateEmail, MdContentCopy } from "react-icons/md";

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
        <ContextMenu.Content
          style={{ minWidth: 180 }}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <ContextMenu.Label style={{ fontWeight: "bold" }}>
            {nickname}
          </ContextMenu.Label>
          <ContextMenu.Separator />
          <ContextMenu.Item onClick={() => openSettings("profile")}>
            Edit Profile
          </ContextMenu.Item>
          {serverUserId && (
            <ContextMenu.Item onClick={handleCopyId}>
              <Flex align="center" gap="2">
                <MdContentCopy size={14} /> Copy ID
              </Flex>
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
        </ContextMenu.Content>
      </ContextMenu.Root>
    );
  }

  if (!serverUserId) {
    return <>{children}</>;
  }

  const volume = userVolumes[serverUserId] ?? 100;
  const showDisconnect = canDisconnect && isInVoice && onDisconnectFromVoice;
  const isAdmin = role === "owner" || role === "admin";
  const canAct = isAdmin && canTarget(role, targetRole);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger style={{ display: "contents" }}>{children}</ContextMenu.Trigger>
      <ContextMenu.Content
        style={{ minWidth: 220 }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ContextMenu.Label style={{ fontWeight: "bold" }}>
          {nickname}
        </ContextMenu.Label>
        {targetRole && (
          <ContextMenu.Label>
            <Text size="1" color="gray" style={{ textTransform: "capitalize" }}>{targetRole}</Text>
          </ContextMenu.Label>
        )}
        <ContextMenu.Item onClick={handleMention}>
          <Flex align="center" gap="2">
            <MdAlternateEmail size={14} /> Mention
          </Flex>
        </ContextMenu.Item>
        <ContextMenu.Item onClick={handleCopyId}>
          <Flex align="center" gap="2">
            <MdContentCopy size={14} /> Copy ID
          </Flex>
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <Flex
          direction="column"
          gap="2"
          px="2"
          py="1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Flex align="center" justify="between">
            <Text size="1" color="gray">Volume</Text>
            <Text size="1" weight="medium" style={{ fontVariantNumeric: "tabular-nums" }}>
              {volume}%
            </Text>
          </Flex>
          <Slider
            min={0}
            max={200}
            step={1}
            value={[volume]}
            onValueChange={([v]) => updateUserVolume(serverUserId, v)}
            size="1"
          />
        </Flex>
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
            <ContextMenu.Item color="red" onClick={onDisconnectFromVoice}>
              Disconnect from voice
            </ContextMenu.Item>
          </>
        )}

        {canAct && (
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
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger>Change role</ContextMenu.SubTrigger>
                <ContextMenu.SubContent>
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
                </ContextMenu.SubContent>
              </ContextMenu.Sub>
            )}

            <ContextMenu.Separator />

            {onKick && (
              <ContextMenu.Item color="red" onClick={onKick}>
                Kick from server
              </ContextMenu.Item>
            )}

            {onBan && (
              <ContextMenu.Item color="red" onClick={onBan}>
                Ban from server
              </ContextMenu.Item>
            )}
          </>
        )}
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
