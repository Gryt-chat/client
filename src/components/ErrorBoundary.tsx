import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <Flex
        width="100vw"
        height="100vh"
        align="center"
        justify="center"
        style={{ background: "var(--color-background)" }}
      >
        <Box style={{ textAlign: "center", maxWidth: 420, padding: 32 }}>
          <Text size="5" weight="bold" mb="3" as="p">
            Something went wrong
          </Text>
          <Text size="2" color="gray" mb="4" as="p" style={{ marginTop: 8 }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </Text>
          <Button
            variant="solid"
            style={{ marginTop: 16 }}
            onClick={() => window.location.reload()}
          >
            Reload
          </Button>
        </Box>
      </Flex>
    );
  }
}
