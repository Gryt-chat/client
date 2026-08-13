import { Button, Chip, IconButton, Menu, Surface, Tooltip } from "@gryt/ui";
import { PiPushPinFill } from "react-icons/pi";

export const ServerHeader = ({
  serverName,
  onLeave,
  onOpenSettings,
  onOpenReports,
  role,
  pendingReportCount,
  updateAvailable,
  pinned,
  onTogglePinned,
}: {
  serverName?: string;
  onLeave: () => void;
  onOpenSettings?: () => void;
  onOpenReports?: () => void;
  role?: "owner" | "admin" | "mod" | "member";
  pendingReportCount?: number;
  updateAvailable?: boolean;
  pinned?: boolean;
  onTogglePinned?: () => void;
}) => {
  const canManage = role === "owner" || role === "admin";
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
                <PiPushPinFill size={14} />
              </IconButton>
            </Tooltip>
          )}

          <Menu.Root>
            <Menu.Trigger>
              <Button tone="neutral" size="xsmall">
                
              </Button>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner>
                <Menu.Popup>
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