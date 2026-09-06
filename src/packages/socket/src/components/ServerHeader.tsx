import { Chip, IconButton, Menu, Surface, Tooltip } from "@gryt/ui";
import toast from "react-hot-toast";

import { PiDotsThreeVerticalBold, PiPushPinFill, PiPushPinSlashFill } from "../../../../lib/icons";

export const ServerHeader = ({
  serverName,
  serverHost,
  onLeave,
  onCreateChannel,
  onCreateFolder,
  onOpenInvites,
  onOpenSettings,
  onOpenReports,
  role,
  pendingReportCount,
  updateAvailable,
  pinned,
  onTogglePinned,
}: {
  serverName?: string;
  /** For "Copy server address". Absent hides that item rather than copying "". */
  serverHost?: string;
  onLeave: () => void;
  onCreateChannel?: () => void;
  onCreateFolder?: () => void;
  onOpenInvites?: () => void;
  onOpenSettings?: () => void;
  onOpenReports?: () => void;
  role?: string;
  pendingReportCount?: number;
  updateAvailable?: boolean;
  pinned?: boolean;
  onTogglePinned?: () => void;
}) => {
  const canManage = role === "owner" || role === "admin";

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
          {onTogglePinned && (
            <Tooltip title={pinned ? "Unpin sidebar" : "Pin sidebar"}>
              <IconButton tone="neutral" size="xsmall"
                onClick={onTogglePinned}
                aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
              >
                {pinned ? <PiPushPinFill size={14} /> : <PiPushPinSlashFill size={14} />}
              </IconButton>
            </Tooltip>
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
              {/*
                Ordered to match the server menu people already know from
                elsewhere: invite and settings, then the things you make, then
                moderation, then the identifier, then leaving.

                The items Gryt has no equivalent for are simply absent rather
                than shown disabled — boosting, insights, events, threads, an
                app directory, per-server profiles, and the raid tools. A
                disabled row advertises a feature that does not exist.

                Two are missing for a reason rather than by omission. Muting
                this server is on the channel list's own right-click, where the
                per-channel and per-folder choices live, and splitting one
                setting across two menus is worse than one extra click. "Show
                all channels" needs a per-person hidden-channel list, which
                Gryt does not have — visibility here is a permission.
              */}
              {canManage && onOpenInvites && (
                <Menu.Item onClick={onOpenInvites}>Invite to server</Menu.Item>
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

              {canManage && (onOpenInvites || onOpenSettings) && (onCreateChannel || onCreateFolder) && (
                <Menu.Separator />
              )}

              {canManage && onCreateChannel && (
                <Menu.Item onClick={onCreateChannel}>Create channel</Menu.Item>
              )}
              {/* Discord calls this a category. Gryt's folders are the same
                  idea and the sidebar already says folder, so it says folder. */}
              {canManage && onCreateFolder && (
                <Menu.Item onClick={onCreateFolder}>Create folder</Menu.Item>
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

              {/* The address, not an id. It is what identifies a Gryt server,
                  it is what somebody else needs to reach it, and unlike a
                  snowflake it is worth pasting to a person. Everyone gets it:
                  anybody who is here already knows it. */}
              {serverHost && <Menu.Separator />}
              {serverHost && (
                <Menu.Item onClick={copyHost}>Copy server address</Menu.Item>
              )}

              <Menu.Separator />
              <Menu.Item className="text-gryt-danger" onClick={onLeave}>
                Leave
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
