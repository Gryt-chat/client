import { Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { PiArrowsClockwiseFill, PiWifiSlashFill } from "react-icons/pi";

interface ConnectionBannerProps {
  connectionStatus: string;
  onReconnect: () => void;
}

export const ConnectionBanner = ({ connectionStatus, onReconnect }: ConnectionBannerProps) => {
  const isReconnecting = connectionStatus === "reconnecting";
  return (
    <Flex
      align="center" gap="3" px="3" py="2"
      style={{
        flexShrink: 0,
        borderRadius: "var(--radius-5)",
        background: isReconnecting ? "var(--orange-a3)" : "var(--red-a3)",
        border: `1px solid ${isReconnecting ? "var(--orange-a5)" : "var(--red-a5)"}`,
      }}
    >
      {isReconnecting
        ? <Spinner size="1" />
        : <PiWifiSlashFill size={14} color="var(--red-9)" style={{ flexShrink: 0 }} />}
      <Text size="2" weight="medium" style={{ flex: 1 }}>
        {isReconnecting ? "Reconnecting to server..." : "Server is unreachable"}
      </Text>
      {connectionStatus === "disconnected" && (
        <Button size="1" variant="soft" style={{ flexShrink: 0 }} onClick={onReconnect}>
          <PiArrowsClockwiseFill size={12} /> Reconnect
        </Button>
      )}
    </Flex>
  );
};
