import { Button, Chip, IconButton, Surface, Tooltip } from "@gryt/ui";
import { DropdownMenu, Flex, Text } from "@radix-ui/themes";
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
      <Flex justify="between" align="center">
        <Text>{serverName}</Text>
        <Flex align="center" gap="2">
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

          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button tone="neutral" size="xsmall">
                <DropdownMenu.TriggerIcon />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {canManage && onOpenSettings && (
                <DropdownMenu.Item onClick={onOpenSettings}>
                  <Flex align="center" gap="2">
                    Server settings
                    {updateAvailable && (
                      <Chip tone="warning" label="!" />
                    )}
                  </Flex>
                </DropdownMenu.Item>
              )}
              {canManage && onOpenReports && (
                <DropdownMenu.Item onClick={onOpenReports}>
                  <Flex align="center" gap="2">
                    Reports
                    {!!pendingReportCount && pendingReportCount > 0 && (
                      <Chip tone="danger">
                        {pendingReportCount}
                      </Chip>
                    )}
                  </Flex>
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Separator />
              <DropdownMenu.Item color="red" onClick={onLeave}>
                Leave
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Flex>
      </Flex>
    </Surface>
  );
}; 