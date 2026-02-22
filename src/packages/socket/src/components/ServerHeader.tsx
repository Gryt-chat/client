import { Badge, Button, Card, DropdownMenu, Flex, Text } from "@radix-ui/themes";

export const ServerHeader = ({
  serverName,
  onLeave,
  onOpenSettings,
  onOpenReports,
  role,
  pendingReportCount,
}: {
  serverName?: string;
  onLeave: () => void;
  onOpenSettings?: () => void;
  onOpenReports?: () => void;
  role?: "owner" | "admin" | "mod" | "member";
  pendingReportCount?: number;
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
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <Button variant="soft" size="1" color="gray">
              <DropdownMenu.TriggerIcon />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            {canManage && onOpenSettings && (
              <DropdownMenu.Item onClick={onOpenSettings}>Server settings</DropdownMenu.Item>
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
    </Card>
  );
}; 