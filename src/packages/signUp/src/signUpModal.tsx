import { Button, Flex, Text } from "@radix-ui/themes";
import { useState } from "react";

import { Logo, useAccount } from "@/common";

export function SignUpModal() {
  const [error, setError] = useState<string | undefined>(undefined);

  const { login, register, registrationAllowed } = useAccount();

  return (
    <Flex
      align="center"
      justify="center"
      style={{
        padding: "64px",
      }}
      width="100%"
      height="100%"
    >
      <div>
        <Flex direction="column" gap="6" width="280px">
          <Logo />
          <Flex direction="column" gap="3">
            <Button
              onClick={async () => {
                try {
                  setError(undefined);
                  await login();
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : "Sign in failed. Please try again.");
                }
              }}
            >
              Sign in with Gryt
            </Button>
            {registrationAllowed && (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    setError(undefined);
                    await register();
                  } catch (e: unknown) {
                    setError(e instanceof Error ? e.message : "Registration failed. Please try again.");
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
