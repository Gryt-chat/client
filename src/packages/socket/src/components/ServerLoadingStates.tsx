import { Box, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { MdError, MdRefresh, MdSchedule, MdWifiOff } from "react-icons/md";

import { ServerDetailsSkeleton } from "./skeletons";

interface ServerLoadingStatesProps {
  serverFailure?: { error: string; message?: string };
  hasTimedOut: boolean;
  connectionStatus?: 'connected' | 'disconnected' | 'connecting' | 'reconnecting';
  onReconnect?: () => void;
}

const cardStyle: React.CSSProperties = {
  textAlign: "center",
  maxWidth: 380,
  padding: "40px 32px",
  borderRadius: "var(--radius-6)",
  background: "var(--color-panel-solid)",
  border: "1px solid var(--gray-5)",
  boxShadow: "0 1px 4px var(--gray-a3)",
};

const iconWrapStyle = (bg: string): React.CSSProperties => ({
  width: 56,
  height: 56,
  borderRadius: "var(--radius-5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: bg,
  flexShrink: 0,
});

export const ServerLoadingStates = ({
  serverFailure,
  hasTimedOut,
  connectionStatus,
  onReconnect,
}: ServerLoadingStatesProps) => {
  if (serverFailure) {
    return (
      <Flex width="100%" height="100%" align="center" justify="center" p="4">
        <Box style={cardStyle}>
          <Flex direction="column" align="center" gap="4">
            <div style={iconWrapStyle("var(--red-a3)")}>
              <MdError size={28} color="var(--red-9)" />
            </div>
            <Flex direction="column" gap="2" align="center">
              <Text size="4" weight="bold">
                Failed to load server
              </Text>
              <Text size="2" color="gray" style={{ lineHeight: 1.5 }}>
                {serverFailure.error === "rate_limited"
                  ? "You're being rate limited. Please wait a moment and try again."
                  : serverFailure.message ||
                    "An error occurred while loading server details."}
              </Text>
            </Flex>
            <Button
              onClick={() => window.location.reload()}
              variant="solid"
              size="2"
              style={{ marginTop: 4 }}
            >
              <MdRefresh size={16} />
              Retry
            </Button>
          </Flex>
        </Box>
      </Flex>
    );
  }

  if (connectionStatus === 'reconnecting') {
    return (
      <Flex width="100%" height="100%" align="center" justify="center" p="4">
        <Box style={cardStyle}>
          <Flex direction="column" align="center" gap="4">
            <div style={{
              ...iconWrapStyle("var(--orange-a3)"),
              animation: "pulse-reconnect 2s ease-in-out infinite",
            }}>
              <Spinner size="3" />
            </div>
            <Flex direction="column" gap="2" align="center">
              <Text size="4" weight="bold">
                Reconnecting...
              </Text>
              <Text size="2" color="gray" style={{ lineHeight: 1.5 }}>
                Lost connection to the server. Attempting to reconnect automatically.
              </Text>
            </Flex>
          </Flex>
        </Box>
      </Flex>
    );
  }

  if (connectionStatus === 'disconnected') {
    return (
      <Flex width="100%" height="100%" align="center" justify="center" p="4">
        <Box style={cardStyle}>
          <Flex direction="column" align="center" gap="4">
            <div style={iconWrapStyle("var(--red-a3)")}>
              <MdWifiOff size={26} color="var(--red-9)" />
            </div>
            <Flex direction="column" gap="2" align="center">
              <Text size="4" weight="bold">
                Server unreachable
              </Text>
              <Text size="2" color="gray" style={{ lineHeight: 1.5 }}>
                Unable to establish a connection. The server may be offline or there could be a network issue.
              </Text>
            </Flex>
            <Button
              onClick={onReconnect ?? (() => window.location.reload())}
              variant="solid"
              size="2"
              style={{ marginTop: 4 }}
            >
              <MdRefresh size={16} />
              Reconnect
            </Button>
          </Flex>
        </Box>
      </Flex>
    );
  }

  if (!hasTimedOut) {
    return (
      <Flex width="100%" height="100%" gap="4">
        <Box width={{ sm: "240px", initial: "100%" }}>
          <ServerDetailsSkeleton />
        </Box>
      </Flex>
    );
  }

  return (
    <Flex width="100%" height="100%" align="center" justify="center" p="4">
      <Box style={cardStyle}>
        <Flex direction="column" align="center" gap="4">
          <div style={iconWrapStyle("var(--orange-a3)")}>
            <MdSchedule size={26} color="var(--orange-9)" />
          </div>
          <Flex direction="column" gap="2" align="center">
            <Text size="4" weight="bold">
              Taking longer than expected
            </Text>
            <Text size="2" color="gray" style={{ lineHeight: 1.5 }}>
              The server is taking a while to respond. This could be due to network conditions or the server being under load.
            </Text>
          </Flex>
          <Button
            onClick={onReconnect ?? (() => window.location.reload())}
            variant="solid"
            size="2"
            style={{ marginTop: 4 }}
          >
            <MdRefresh size={16} />
            Retry
          </Button>
        </Flex>
      </Box>
    </Flex>
  );
};
