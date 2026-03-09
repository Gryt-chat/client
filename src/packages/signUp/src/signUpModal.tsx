import { Button, Flex, Text, TextField } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { MdExpandLess, MdExpandMore } from "react-icons/md";

import { Logo, readPendingInvite, resetKeycloakInit, useAccount } from "@/common";

import { getCustomAuthIssuer, getGrytConfig, setCustomAuthIssuer } from "../../../config";

const RETRY_DELAY_S = 15;

const DEFAULT_ISSUER = "https://auth.gryt.chat/realms/gryt";

export function SignUpModal() {
  const [error, setError] = useState<string | undefined>(undefined);
  const { login, register, registrationAllowed, loginInProgress, cancelLogin } =
    useAccount();
  const pendingInvite = readPendingInvite();

  const [countdown, setCountdown] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(
    () => !!getCustomAuthIssuer(),
  );
  const [authInput, setAuthInput] = useState(
    () => getCustomAuthIssuer() || "",
  );
  const [saved, setSaved] = useState(false);

  const isCustom = authInput.length > 0 && authInput !== DEFAULT_ISSUER;
  const currentIssuer = getGrytConfig().GRYT_OIDC_ISSUER;

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

  function saveAuthServer() {
    const trimmed = authInput.trim().replace(/\/+$/, "");
    if (!trimmed || trimmed === DEFAULT_ISSUER) {
      setCustomAuthIssuer(null);
      setAuthInput("");
    } else {
      setCustomAuthIssuer(trimmed);
      setAuthInput(trimmed);
    }
    resetKeycloakInit();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
                  : isCustom
                    ? "Sign in with custom auth"
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
          <Flex direction="column" gap="3">
            <Text
              size="1"
              color="gray"
              style={{ cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4 }}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? <MdExpandLess size={16} /> : <MdExpandMore size={16} />}
              Advanced
            </Text>
            {showAdvanced && (
              <Flex direction="column" gap="2">
                <Text size="1" color="gray">
                  Auth server (OIDC issuer URL)
                </Text>
                <TextField.Root
                  size="2"
                  placeholder={DEFAULT_ISSUER}
                  value={authInput}
                  onChange={(e) => {
                    setAuthInput(e.target.value);
                    setSaved(false);
                  }}
                  onBlur={saveAuthServer}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveAuthServer();
                  }}
                />
                <Text size="1" color="gray">
                  {saved
                    ? "Saved"
                    : isCustom
                      ? `Using: ${currentIssuer}`
                      : "Leave empty to use the default Gryt auth server."}
                </Text>
              </Flex>
            )}
          </Flex>
        </Flex>
      </div>
    </Flex>
  );
}
