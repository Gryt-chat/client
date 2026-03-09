import { Badge, Button, Card, DropdownMenu, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { MdPushPin } from "react-icons/md";

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
    <Card
      style={{
        width: "100%",
        flexShrink: 0,
      }}
    >
      <Flex justify="between" align="center">
        <Text>{serverName}</Text>
        <Flex align="center" gap="2">
          {onTogglePinned && (
            <Tooltip content={pinned ? "Unpin sidebar" : "Pin sidebar"} delayDuration={200}>
              <IconButton
                size="1"
                variant={pinned ? "solid" : "soft"}
                color="gray"
                onClick={onTogglePinned}
                aria-label={pinned ? "Unpin sidebar" : "Pin sidebar"}
              >
                <MdPushPin size={14} />
              </IconButton>
            </Tooltip>
          )}

          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <Button variant="soft" size="1" color="gray">
                <DropdownMenu.TriggerIcon />
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content>
              {canManage && onOpenSettings && (
                <DropdownMenu.Item onClick={onOpenSettings}>
                  <Flex align="center" gap="2">
                    Server settings
                    {updateAvailable && (
                      <Badge color="orange" variant="soft" size="1" radius="full">
                        !
                      </Badge>
                    )}
                  </Flex>
                </DropdownMenu.Item>
              )}
              {canManage && onOpenReports && (
                <DropdownMenu.Item onClick={onOpenReports}>
                  <Flex align="center" gap="2">
                    Reports
                    {!!pendingReportCount && pendingReportCount > 0 && (
                      <Badge color="red" variant="solid" size="1" radius="full">
                        {pendingReportCount}
                      </Badge>
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
    </Card>
  );
}; 