import { Button, Flex, Text } from "@radix-ui/themes";
import { useState } from "react";

import { Logo, readPendingInvite, useAccount } from "@/common";

export function SignUpModal() {
  const [error, setError] = useState<string | undefined>(undefined);
  const { login, register, registrationAllowed, loginInProgress } =
    useAccount();
  const pendingInvite = readPendingInvite();

  return (
    <Flex
      align="center"
      justify="center"
      style={{ padding: "64px" }}
      width="100%"
      height="100%"
    >
      <div>
        <Flex direction="column" gap="6" width="280px">
          <Logo />
          {pendingInvite && (
            <Flex
              direction="column"
              gap="1"
              style={{
                background: "var(--accent-a3)",
                border: "1px solid var(--accent-a5)",
                borderRadius: "var(--radius-3)",
                padding: "12px 16px",
              }}
            >
              <Text size="2" weight="medium">
                You've been invited to a server
              </Text>
              <Text
                size="1"
                color="gray"
                style={{ fontFamily: "var(--code-font-family)" }}
              >
                {pendingInvite.host}
              </Text>
              <Text size="1" color="gray" style={{ marginTop: 4 }}>
                Sign in to accept the invite.
              </Text>
            </Flex>
          )}
          <Flex direction="column" gap="3">
            <Button
              disabled={loginInProgress}
              onClick={async () => {
                try {
                  setError(undefined);
                  await login();
                } catch (e: unknown) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Sign in failed. Please try again.",
                  );
                }
              }}
            >
              {loginInProgress
                ? "Waiting for sign in\u2026"
                : "Sign in with Gryt"}
            </Button>
            {registrationAllowed && (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    setError(undefined);
                    await register();
                  } catch (e: unknown) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Registration failed. Please try again.",
                    );
                  }
                }}
              >
                Create a new account
              </Button>
            )}
            {error && (
              <Text color="red" size="1" weight="medium">
                {error}
              </Text>
            )}
          </Flex>
        </Flex>
      </div>
    </Flex>
  );
}
