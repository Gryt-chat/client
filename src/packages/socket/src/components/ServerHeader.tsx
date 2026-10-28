import { Chip, IconButton, Menu, Surface } from "@gryt/ui";
import toast from "react-hot-toast";

import { NotificationLevelMenu } from "@/common";

import { PiBellFill, PiCaretDownFill, PiCopySimpleBold, PiDoorOpenBold, PiFolderFill, PiGearSixFill, PiHardDrivesFill, PiHashBold, PiLinkSimpleBold, PiMinusCircleFill, PiPuzzlePieceFill, PiUserPlusFill } from "../../../../lib/icons";
import { useOpenInviteLink } from "../hooks/useOpenInviteLink";
import { MarkAsReadItem } from "./MarkAsReadItem";

/** "Friday LAN" → "FL": the first letter of the first two words. */
function initialsOf(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

export const ServerHeader = ({
  serverName,
  serverHost,
  onLeave,
  onCreateChannel,
  onCreateFolder,
  onOpenInvites,
  onOpenSettings,
  onManageServer,
  role,
  canManageChannels,
  pendingReportCount,
  updateAvailable,
  statusLine,
  iconsOnly = false,
}: {
  serverName?: string;
  /** The narrow channel list: the server's initials, which open its menu (GRYT-1899). */
  iconsOnly?: boolean;
  /** Why the server isn't usable right now, under its name (GRYT-1751). */
  statusLine?: string;
  /** For "Copy server address". Absent hides that item rather than copying "". */
  serverHost?: string;
  /**
   * One of the two ways out. Removing is local and keeps the membership;
   * leaving ends it. GRYT-988.
   */
  onLeave: (mode: "remove" | "leave") => void;
  onCreateChannel?: () => void;
  onCreateFolder?: () => void;
  onOpenInvites?: () => void;
  onOpenSettings?: () => void;
  /** This app's controls for the server. Only passed when this app hosts it. Server settings has them too. */
  onManageServer?: () => void;
  role?: string;
  /** `manage_channels`, for creating channels and folders. `role` gates the server's own settings. */
  canManageChannels?: boolean;
  pendingReportCount?: number;
  updateAvailable?: boolean;
}) => {
  const canManage = role === "owner" || role === "admin";
  /* Everyone's, not just managers': on a server anyone can join, sharing it gives nothing away. */
  const openInvite = useOpenInviteLink(serverHost);

  const copyHost = async () => {
    if (!serverHost) return;
    try {
      await navigator.clipboard.writeText(serverHost);
      toast.success("Server address copied");
    } catch {
      // Clipboard access can be refused, and a silent no-op looks like a menu
      // item that does nothing.
      toast.error("Could not copy the address");
    }
  };

  const createItems = canManageChannels && (onCreateChannel || onCreateFolder);
  const adminItems = createItems || (canManage && onOpenSettings) || onManageServer;

  return (
    <Surface
      style={{
        width: "100%",
        flexShrink: 0,
      }}
    >
      <Menu.Root>
        {/* render, not children: Menu.Trigger is a button already, and a
            button inside a button is invalid HTML. */}
        {iconsOnly ? (
          <div className="flex justify-center items-center">
            <Menu.Trigger
              render={
                <IconButton tone="neutral" size="xsmall" aria-label="Server menu" className="w-auto px-1 text-base font-semibold" />
              }
            >
              {initialsOf(serverName)}
            </Menu.Trigger>
          </div>
        ) : (
          <Menu.Trigger
            aria-label={`${serverName ?? "Server"} menu`}
            className="flex w-full items-center gap-2 min-w-0 rounded-lg px-2 py-1 -mx-2 text-left hover:bg-gryt-neutral-3"
          >
            <span className="flex flex-col flex-1 min-w-0">
              <span className="truncate font-semibold">{serverName}</span>
              {statusLine && (
                <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--gryt-warning-11)" }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gryt-warning-9)" }} />
                  {statusLine}
                </span>
              )}
            </span>
            <PiCaretDownFill size={12} className="shrink-0 opacity-70" />
          </Menu.Trigger>
        )}
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup>
              {/* Getting people in. The invite dialog has the open link too, so managers only need the one row. */}
              {canManage && onOpenInvites ? (
                <Menu.Item onClick={onOpenInvites}><PiUserPlusFill size={16} />Invite people</Menu.Item>
              ) : openInvite.available && (
                <Menu.Item onClick={() => void openInvite.copy()}><PiLinkSimpleBold size={16} />Copy invite link</Menu.Item>
              )}
              {/* The address is what identifies a Gryt server and what somebody else needs to reach it. */}
              {serverHost && (
                <Menu.Item onClick={copyHost}><PiCopySimpleBold size={16} />Copy server address</Menu.Item>
              )}

              {serverHost && (
                <>
                  <Menu.Separator />
                  {/* The same control as the rail's right-click and a channel's ⋯ (GRYT-1771). */}
                  <NotificationLevelMenu host={serverHost} scope={{ kind: "server" }} inMenu icon={<PiBellFill size={16} />} />
                  <MarkAsReadItem host={serverHost} scope={{ kind: "server" }} inMenu />
                </>
              )}

              {adminItems && <Menu.Separator />}
              {/* Discord calls it a category. The sidebar already says folder, so this does too. */}
              {canManageChannels && onCreateChannel && (
                <Menu.Item onClick={onCreateChannel}><PiHashBold size={16} />Create channel</Menu.Item>
              )}
              {canManageChannels && onCreateFolder && (
                <Menu.Item onClick={onCreateFolder}><PiFolderFill size={16} />Create folder</Menu.Item>
              )}
              {canManage && onOpenSettings && (
                <Menu.Item onClick={onOpenSettings}>
                  <div className="flex items-center gap-2">
                    <PiGearSixFill size={16} />
                    Server settings
                    {updateAvailable && (
                      <Chip tone="warning" label="!" />
                    )}
                    {!!pendingReportCount && pendingReportCount > 0 && (
                      <Chip tone="danger">{pendingReportCount}</Chip>
                    )}
                  </div>
                </Menu.Item>
              )}
              {/* Not gated on role. It is this machine's process, which the server's roles have no say over. */}
              {onManageServer && !(canManage && onOpenSettings) && (
                <Menu.Item onClick={onManageServer}><PiHardDrivesFill size={16} />Manage server</Menu.Item>
              )}

              <Menu.Separator />
              {/* Everyone's, and next to Leave on purpose (GRYT-942): a server plugin reads what goes through it. */}
              {serverHost && (
                <Menu.Item
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("server_plugins_open", { detail: { host: serverHost } }),
                    )
                  }
                >
                  <PiPuzzlePieceFill size={16} />
                  Plugins
                </Menu.Item>
              )}
              <Menu.Item onClick={() => onLeave("remove")}>
                <PiMinusCircleFill size={16} />
                Remove from sidebar
              </Menu.Item>
              <Menu.Item className="text-gryt-danger" onClick={() => onLeave("leave")}>
                <PiDoorOpenBold size={16} />
                Leave server
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </Surface>
  );
};
