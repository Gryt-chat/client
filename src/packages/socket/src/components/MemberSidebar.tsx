import { Avatar, IconButton, PreviewCard, Tooltip } from "@gryt/ui";
import { useCallback, useMemo, useState } from "react";

import { getUploadsFileUrl, resolveAvatarSrc, useTheme } from "@/common";

import { PiPushPinFill, PiPushPinSlashFill } from "../../../../lib/icons";
import { useServerPermissions } from "../hooks/usePermissions";
import { UserStatus } from "../types/clients";
import { BotTag } from "./BotTag";
import { groupMembersByRole, readableRoleColor } from "./memberGroups";
import { MemberIdentityCard } from "./MemberIdentityCard";
import { statusConfig } from "./memberStatus";
import { PluginPanels } from "./PluginPanels";
import { UserContextMenu } from "./UserContextMenu";

/** A role id. The server defines its own; these only pass one along. */
type Role = string;

export interface MemberInfo {
  serverUserId: string;
  nickname: string;
  avatarFileId?: string | null;
  /** Dominant colour of the avatar as #rrggbb. Null until it has been computed. */
  avatarColor?: string | null;
  /**
   * What their owl is wearing, if they designed one. Drawn rather than fetched.
   * Outranks `avatarFileId`; see `resolveAvatarSrc` for why both are set.
   */
  avatarWorn?: string | null;
  /**
   * The role their name is coloured by: the highest ranked one they hold. Still a
   * single id; `roles` below is all of them (GRYT-748).
   */
  role?: Role;
  /**
   * Everything they hold, highest ranked first, with `role` at the front. Absent
   * is not empty — an older server has no opinion, so callers fall back to `role`.
   */
  roles?: Role[];
  status: UserStatus;
  /**
   * What they say they are doing, in their own words. The server holds it on the
   * connection, so somebody offline never has one (GRYT-929).
   */
  activity?: string;
  lastSeen?: Date;
  createdAt?: string | Date;
  /** Whether there is a Gryt account behind this member, or only a device key. */
  identityTier?: "account" | "local" | "bot";
  /**
   * Whether this member is a bot. The server derives it from the identity, so it
   * cannot be spoofed by a name and cannot be shaken off by one either.
   */
  isBot?: boolean;
  /**
   * Server-scoped marker for the identity, stable across renames. Not the Gryt
   * user id — that one is the same on every server, and this deliberately is not.
   */
  identityFingerprint?: string;
  /**
   * What this member says their DM public key is, signed by the identity key they
   * joined with. Verified and pinned client-side; the server never reads it.
   */
  dmKeyBinding?: string | null;
  /**
   * How many times this member has renamed themselves here, and when they last
   * did. The old names are deliberately not sent.
   */
  nicknameChangeCount?: number;
  nicknameChangedAt?: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  isServerMuted?: boolean;
  isServerDeafened?: boolean;
  color: string;
  isConnectedToVoice: boolean;
  hasJoinedChannel: boolean;
  voiceChannelId?: string;
  streamID: string;
}

export interface AdminActions {
  onDisconnectUser?: (targetServerUserId: string) => void;
  onKickUser?: (targetServerUserId: string) => void;
  onBanUser?: (targetServerUserId: string) => void;
  onServerMuteUser?: (targetServerUserId: string, muted: boolean) => void;
  onServerDeafenUser?: (targetServerUserId: string, deafened: boolean) => void;
  onToggleRole?: (targetServerUserId: string, role: Role, hold: boolean) => void;
}

interface MemberSidebarProps {
  members: MemberInfo[];
  currentConnectionId?: string;
  currentServerUserId?: string;
  currentUserRole?: Role;
  currentServerConnected: string | null;
  serverHost: string;
  adminActions?: AdminActions;
  /**
   * Open a direct message with a member. Not part of `adminActions`: anybody may
   * message anybody, and the server decides rather than the menu guessing.
   */
  onOpenDm?: (targetServerUserId: string) => void;
  onToggleBlock?: (targetServerUserId: string) => void;
  isBlocked?: (serverUserId: string) => boolean;
  /** Opens the report dialog. The nickname comes along so the dialog can name them. */
  onReport?: (target: { serverUserId: string; nickname: string }) => void;
  pinned?: boolean;
  onTogglePinned?: () => void;
}


const MemberItem = ({
  member,
  roleColor,
  currentServerUserId,
  currentUserRole,
  serverHost,
  adminActions,
  onOpenDm,
  onToggleBlock,
  isBlocked,
  onReport,
  cardOpen,
  onCardOpenChange,
}: {
  member: MemberInfo;
  /** Already pulled into a readable band — see `readableRoleColor`. */
  roleColor?: string;
  currentServerUserId?: string;
  currentUserRole?: Role;
  serverHost: string;
  adminActions?: AdminActions;
  onOpenDm?: (targetServerUserId: string) => void;
  onToggleBlock?: (targetServerUserId: string) => void;
  isBlocked?: (serverUserId: string) => boolean;
  onReport?: (target: { serverUserId: string; nickname: string }) => void;
  /** Held by the list, not here. See the note on `openCardFor`. */
  cardOpen: boolean;
  onCardOpenChange: (open: boolean) => void;
}) => {
  const isSelf = member.serverUserId === currentServerUserId;
  const { label: statusLabel, color: statusColor } = statusConfig[member.status];
  const isOffline = member.status === "offline";
  const showStatusLine = member.status === "in_voice" || member.status === "afk";

  return (
    <UserContextMenu
      serverHost={serverHost}
      serverUserId={member.serverUserId}
      nickname={member.nickname}
      isSelf={isSelf}
      canDisconnect={!!adminActions?.onDisconnectUser}
      isInVoice={member.hasJoinedChannel}
      onDisconnectFromVoice={adminActions?.onDisconnectUser ? () => adminActions.onDisconnectUser!(member.serverUserId) : undefined}
      role={currentUserRole}
      targetRole={member.role}
      isServerMuted={member.isServerMuted}
      isServerDeafened={member.isServerDeafened}
      onKick={adminActions?.onKickUser ? () => adminActions.onKickUser!(member.serverUserId) : undefined}
      onBan={adminActions?.onBanUser ? () => adminActions.onBanUser!(member.serverUserId) : undefined}
      onServerMute={adminActions?.onServerMuteUser ? (muted) => adminActions.onServerMuteUser!(member.serverUserId, muted) : undefined}
      onServerDeafen={adminActions?.onServerDeafenUser ? (deafened) => adminActions.onServerDeafenUser!(member.serverUserId, deafened) : undefined}
      onToggleRole={adminActions?.onToggleRole ? (role, hold) => adminActions.onToggleRole!(member.serverUserId, role, hold) : undefined}
      targetRoles={member.roles}
      onOpenDm={onOpenDm && !isSelf ? () => onOpenDm(member.serverUserId) : undefined}
      /* Not on your own row: the server refuses blocking yourself, so the item
         would be one that always fails. */
      onToggleBlock={
        onToggleBlock && !isSelf ? () => onToggleBlock(member.serverUserId) : undefined
      }
      isBlocked={isBlocked?.(member.serverUserId) ?? false}
      /* Not on your own row either, for the same reason. */
      onReport={
        onReport && !isSelf
          ? () => onReport({ serverUserId: member.serverUserId, nickname: member.nickname })
          : undefined
      }
    >
      <PreviewCard.Root open={cardOpen} onOpenChange={onCardOpenChange}>
        <PreviewCard.Trigger>
          <div
            style={{
              background: "var(--gryt-neutral-4)",
              borderRadius: "var(--gryt-radius-xl)",
              padding: "8px 12px",
              cursor: 'default',
            }}
          >
        <div className="flex items-center gap-2 w-full">
          <Avatar
            size="small"
            fallback={member.nickname[0]}
            src={resolveAvatarSrc(member.avatarFileId ? getUploadsFileUrl(serverHost, member.avatarFileId, { thumb: true }) : undefined, member.nickname, member.avatarWorn)}
            style={{
              backgroundColor: member.color,
              opacity: isOffline ? 0.4 : 1,
            }}
          />

          <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: "1px" }}>
            <div className="flex items-center gap-1">
              {/* The role's colour, or the ordinary text colour when the role
                  has none. Offline keeps its role colour and is dimmed rather
                  than greyed, so a name in the Offline group still reads as
                  that role's without competing with the people who are here.

                  0.7 rather than the 0.4 the avatar uses: composited over the
                  row it lands at 3.0–4.2:1 depending on hue, against 2.71:1
                  for the flat grey this replaced. Dimmer than the names above
                  it, and more legible than what shipped. */}
              <span className="text-sm" style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: roleColor,
                  opacity: isOffline ? 0.7 : 1,
                }}>
                {member.nickname}
              </span>
              {member.isBot && <BotTag size="small" />}
            </div>

            {/* Only when it says something. Every row used to carry a status
                line, which under a heading of people who are all here meant a
                column of the word "Online", and inside the Offline group meant
                the word "Offline" under every name. In Voice and AFK are the
                two that are worth a line. */}
            {showStatusLine && (
              <span className="text-xs" style={{ color: statusColor, lineHeight: 1.2 }}>
                {statusLabel}
              </span>
            )}

            {/* What they say they are doing (GRYT-929).

                Under the derived line rather than instead of it: "In Voice" is
                the server's answer to where somebody is and this is their own
                answer to what they are up to, and a call worth joining is the
                more urgent of the two.

                One line, clipped. The server caps the text at 96 characters
                and strips anything that would break the row, but a narrow
                sidebar can still run out of width before that. */}
            {member.activity && (
              <span
                className="text-xs"
                style={{
                  color: "var(--gryt-neutral-11)",
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={member.activity}
              >
                {member.activity}
              </span>
            )}
          </div>
        </div>
          </div>
        </PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner side="left" align="start">
            <PreviewCard.Popup>
          <MemberIdentityCard member={member} serverHost={serverHost} />
        </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </UserContextMenu>
  );
};

export const MemberSidebar = ({
  members,
  currentServerUserId,
  currentUserRole,
  serverHost,
  adminActions,
  onOpenDm,
  onToggleBlock,
  isBlocked,
  onReport,
  pinned,
  onTogglePinned,
}: MemberSidebarProps) => {
  const { roles } = useServerPermissions(serverHost);
  const { resolvedAppearance } = useTheme();

  const groups = useMemo(() => groupMembersByRole(members, roles), [members, roles]);

  /* Whose card is open, held above the groups: a member going offline changes
     their row's section, and a remounted row loses an uncontrolled card. */
  const [openCardFor, setOpenCardFor] = useState<string | null>(null);

  const setCardOpen = useCallback(
    (serverUserId: string, open: boolean) =>
      setOpenCardFor((current) => (open ? serverUserId : current === serverUserId ? null : current)),
    [],
  );

  /**
   * The colour each role's names are drawn in, worked out once for the list.
   * Keyed by role id, not group: Offline holds people from every role.
   */
  const roleColors = useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const role of roles) {
      map.set(role.id, readableRoleColor(role.color, resolvedAppearance));
    }
    return map;
  }, [roles, resolvedAppearance]);

  return (
    <div role="complementary" aria-label="Members" style={{ width: "240px",
        background: "var(--gryt-neutral-3)",
        borderRadius: "var(--gryt-radius-lg)",
        height: "100%",
        overflow: "hidden",
      }}>
      <div className="flex flex-col h-full p-3 gap-1">
        {/*
          No "Members — 12" above the groups (GRYT-904).

          It and a group heading were the same construct — a name, an em dash, a
          count — separated only by size and case, and the first group sits
          directly under it. On a server with one member that read as two
          stacked headings, the upper one apparently empty: "Members — 1" over
          "OWNER — 1". The panel is already the member list; saying so was a
          line that told you where you were and nothing else.

          The region keeps `aria-label="Members"`, so nothing is lost to a
          screen reader. The pin keeps its row.
        */}
        {onTogglePinned && (
          <div className="flex items-center justify-end pb-1">
            <Tooltip title={pinned ? "Unpin sidebar" : "Pin sidebar"}>
              <IconButton tone="neutral" size="xsmall"
                onClick={onTogglePinned}
                aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
              >
                {pinned ? <PiPushPinFill size={14} /> : <PiPushPinSlashFill size={14} />}
              </IconButton>
            </Tooltip>
          </div>
        )}

        <div className="flex flex-col" style={{ overflow: "auto", flex: 1 }}>
          {groups.map((group, index) => (
            <section
              key={group.key}
              aria-labelledby={`members-${group.key}`}
              /* Space above each heading rather than between every row, so the
                 grouping is what the eye picks up. The first sits flush. */
              className={index === 0 ? "" : "mt-4"}
            >
              {/* Sticky, because the whole point of a heading here is knowing
                  whose names you are looking at, and a list of thirty scrolls
                  the answer away. The background is the rail's own, so rows
                  pass underneath rather than through. */}
              <h3
                id={`members-${group.key}`}
                className="text-xs font-bold uppercase tracking-wide text-gryt-muted"
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 1,
                  background: "var(--gryt-neutral-3)",
                  padding: "2px 4px 6px",
                  margin: 0,
                }}
              >
                {group.title} — {group.members.length}
              </h3>

              <div className="flex flex-col gap-1">
                {group.members.map((member) => (
                  <MemberItem
                    key={member.serverUserId}
                    member={member}
                    roleColor={member.role ? roleColors.get(member.role) : undefined}
                    currentServerUserId={currentServerUserId}
                    currentUserRole={currentUserRole}
                    serverHost={serverHost}
                    adminActions={adminActions}
                    onOpenDm={onOpenDm}
                    onToggleBlock={onToggleBlock}
                    isBlocked={isBlocked}
                    onReport={onReport}
                    cardOpen={openCardFor === member.serverUserId}
                    onCardOpenChange={(open) => setCardOpen(member.serverUserId, open)}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* Under the members, inside the same scroll (GRYT-951). A plugin's
              panel is extra rather than instead: the member list stays the
              first thing in this rail, and anything an addon adds sits below
              what Gryt itself knows. */}
          <PluginPanels />
        </div>
      </div>
    </div>
  );
};
