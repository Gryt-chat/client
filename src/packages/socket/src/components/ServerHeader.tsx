import { Chip, IconButton, Menu, Surface, Tooltip } from "@gryt/ui";
import toast from "react-hot-toast";

import { PiDotsThreeVerticalBold, PiPlusBold } from "../../../../lib/icons";
import { useOpenInviteLink } from "../hooks/useOpenInviteLink";

export const ServerHeader = ({
  serverName,
  serverHost,
  onLeave,
  onCreateChannel,
  onCreateFolder,
  onOpenInvites,
  onOpenSettings,
  onManageServer,
  onOpenReports,
  role,
  canManageChannels,
  pendingReportCount,
  updateAvailable,
  pinned,
  onTogglePinned,
}: {
  serverName?: string;
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
  /** This app's controls for the server. Only passed when this app hosts it. */
  onManageServer?: () => void;
  onOpenReports?: () => void;
  role?: string;
  /** `manage_channels`, which the + is for. `role` gates the server's own settings. */
  canManageChannels?: boolean;
  pendingReportCount?: number;
  updateAvailable?: boolean;
  pinned?: boolean;
  onTogglePinned?: () => void;
}) => {
  const canManage = role === "owner" || role === "admin";
  /* Everyone's, not just managers': on a server anyone can join, sharing it gives nothing away. */
  const openInvite = useOpenInviteLink(serverHost);
  const hasTopGroup = Boolean(
    (canManage && (onOpenInvites || onOpenSettings)) || onManageServer || openInvite.available,
  );
  const canCreate = Boolean(canManageChannels && (onCreateChannel || onCreateFolder));

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

  return (
    <Surface
      style={{
        width: "100%",
        flexShrink: 0,
      }}
    >
      <div className="flex justify-between items-center">
        <span>{serverName}</span>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Menu.Root>
              <Tooltip title="Create channel or folder">
                <Menu.Trigger
                  render={
                    <IconButton tone="neutral" size="xsmall" aria-label="Create channel or folder" />
                  }
                >
                  <PiPlusBold size={14} />
                </Menu.Trigger>
              </Tooltip>
              <Menu.Portal>
                <Menu.Positioner>
                  <Menu.Popup>
                    {onCreateChannel && <Menu.Item onClick={onCreateChannel}>Channel</Menu.Item>}
                    {/* Discord calls it a category. The sidebar already says folder, so this does too. */}
                    {onCreateFolder && <Menu.Item onClick={onCreateFolder}>Folder</Menu.Item>}
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          )}

          <Menu.Root>
            {/* render, not children: Menu.Trigger is a button already, and a
                button inside a button is invalid HTML. */}
            <Menu.Trigger
              render={
                <IconButton
                  tone="neutral"
                  size="xsmall"
                  aria-label="Server menu"
                />
              }
            >
              <PiDotsThreeVerticalBold size={14} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner>
                <Menu.Popup>
              {/* Invite and settings, moderation, the pin, the address, then leaving. Nothing is greyed
                  out for a feature Gryt lacks, and muting is on the channel list's right-click. */}
              {canManage && onOpenInvites && (
                <Menu.Item onClick={onOpenInvites}>Invite to server</Menu.Item>
              )}
              {openInvite.available && (
                <Menu.Item onClick={() => void openInvite.copy()}>Copy invite link</Menu.Item>
              )}
              {canManage && onOpenSettings && (
                <Menu.Item onClick={onOpenSettings}>
                  <div className="flex items-center gap-2">
                    Server settings
                    {updateAvailable && (
                      <Chip tone="warning" label="!" />
                    )}
                  </div>
                </Menu.Item>
              )}
              {/* Not gated on role. It is this machine's process, which the server's
                  roles have no say over. */}
              {onManageServer && (
                <Menu.Item onClick={onManageServer}>Manage server</Menu.Item>
              )}

              {canManage && onOpenReports && <Menu.Separator />}
              {canManage && onOpenReports && (
                <Menu.Item onClick={onOpenReports}>
                  <div className="flex items-center gap-2">
                    Reports
                    {!!pendingReportCount && pendingReportCount > 0 && (
                      <Chip tone="danger">
                        {pendingReportCount}
                      </Chip>
                    )}
                  </div>
                </Menu.Item>
              )}

              {onTogglePinned && (hasTopGroup || (canManage && onOpenReports)) && <Menu.Separator />}
              {onTogglePinned && (
                <Menu.Item onClick={onTogglePinned}>{pinned ? "Unpin sidebar" : "Pin sidebar"}</Menu.Item>
              )}

              {/* The address, not an id. It is what identifies a Gryt server,
                  it is what somebody else needs to reach it, and unlike a
                  snowflake it is worth pasting to a person. Everyone gets it:
                  anybody who is here already knows it. */}
              {serverHost && <Menu.Separator />}
              {serverHost && (
                <Menu.Item onClick={copyHost}>Copy server address</Menu.Item>
              )}

              {/* Everyone, not just whoever can manage the place (GRYT-942).
                  A server plugin reads what goes through the server, and the
                  people sending it are who the list is for — a safety net only
                  the operator can see is not one.

                  Next to Leave on purpose. Leaving is what somebody does about
                  what they read here, and putting the two together is the
                  honest arrangement rather than an accident of ordering. */}
              {serverHost && (
                <Menu.Item
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("server_plugins_open", { detail: { host: serverHost } }),
                    )
                  }
                >
                  What this server runs
                </Menu.Item>
              )}

              <Menu.Separator />
              <Menu.Item onClick={() => onLeave("remove")}>
                Remove from sidebar
              </Menu.Item>
              <Menu.Item className="text-gryt-danger" onClick={() => onLeave("leave")}>
                Leave server
              </Menu.Item>
            </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </div>
    </Surface>
  );
};
