import { Button, Flex, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";

import { Logo, readPendingInvite, useAccount } from "@/common";

const RETRY_DELAY_S = 15;

export function SignUpModal() {
  const [error, setError] = useState<string | undefined>(undefined);
  const { login, register, registrationAllowed, loginInProgress, cancelLogin } =
    useAccount();
  const pendingInvite = readPendingInvite();

  const [countdown, setCountdown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (loginInProgress) {
      setCountdown(RETRY_DELAY_S);
      intervalRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1_000);
    } else {
      setCountdown(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loginInProgress]);

  const canRetry = loginInProgress && countdown === 0;

  function handleRetry() {
    cancelLogin();
    setError(undefined);
  }

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
              disabled={loginInProgress && !canRetry}
              onClick={async () => {
                if (canRetry) { handleRetry(); return; }
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
              {canRetry
                ? "Try again"
                : loginInProgress
                  ? `Waiting for sign in\u2026 (${countdown}s)`
                  : "Sign in with Gryt"}
            </Button>
            {registrationAllowed && (
              <Button
                variant="outline"
                disabled={loginInProgress && !canRetry}
                onClick={async () => {
                  if (canRetry) { handleRetry(); return; }
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
                {canRetry ? "Try again" : "Create a new account"}
              </Button>
            )}
            {canRetry && (
              <Text size="1" color="gray">
                Didn't work? Check your browser or email inbox, then try again.
              </Text>
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
