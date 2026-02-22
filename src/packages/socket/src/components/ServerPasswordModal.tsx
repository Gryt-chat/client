import { Cross2Icon, LockClosedIcon } from "@radix-ui/react-icons";
import { Button, Dialog, Flex, IconButton, Text, TextField } from "@radix-ui/themes";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import { getValidIdentityToken } from "@/common";
import { useSettings } from "@/settings";

import { useSockets } from "../hooks/useSockets";

type PasswordRequiredDetail = {
  host: string;
  message?: string;
  reason?: "password_required" | "invalid_password" | "invalid_invite" | "join_required" | string;
  retryAfterMs?: number;
};

export function ServerPasswordModal() {
  const { sockets } = useSockets();
  const { nickname } = useSettings();

  const [isOpen, setIsOpen] = useState(false);
  const [detail, setDetail] = useState<PasswordRequiredDetail | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number>(0);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const host = detail?.host || "";
  const message = detail?.message || "Enter the server password to join this server.";

  const socket = useMemo(() => (host ? sockets[host] : undefined), [sockets, host]);

  useEffect(() => {
    const handler = (event: CustomEvent<PasswordRequiredDetail>) => {
      const next = event.detail;
      setDetail(next);
      setPassword("");
      const retryAfterMs = typeof next.retryAfterMs === "number" && next.retryAfterMs > 0 ? next.retryAfterMs : 0;
      setCooldownUntilMs(retryAfterMs ? Date.now() + retryAfterMs : 0);
      setIsOpen(true);
    };
    window.addEventListener("server_password_required", handler as EventListener);
    return () => window.removeEventListener("server_password_required", handler as EventListener);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (!cooldownUntilMs) return;
    const t = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(t);
  }, [isOpen, cooldownUntilMs]);

  const close = () => {
    if (submitting) return;
    setIsOpen(false);
    setPassword("");
    setDetail(null);
    setCooldownUntilMs(0);
  };

  const submit = async () => {
    if (!host) return;
    if (!socket || !socket.connected) {
      toast.error("Not connected to the server yet. Please wait and try again.");
      return;
    }
    if (cooldownUntilMs && Date.now() < cooldownUntilMs) {
      const remaining = Math.ceil((cooldownUntilMs - Date.now()) / 1000);
      toast.error(`Please wait ${remaining} seconds before trying again.`);
      return;
    }
    const pw = password.trim();
    if (!pw) {
      toast.error("Please enter the server password.");
      return;
    }

    setSubmitting(true);
    try {
      const identityToken = await getValidIdentityToken().catch(() => undefined);
      socket.emit("server:join", {
        password: pw,
        nickname,
        identityToken,
      });
      close();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to send join request.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(o) => (o ? setIsOpen(true) : close())}>
      <Dialog.Content style={{ maxWidth: 480 }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Flex align="center" gap="2">
              <LockClosedIcon />
              <Dialog.Title>Join server</Dialog.Title>
            </Flex>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" onClick={close} disabled={submitting}>
                <Cross2Icon />
              </IconButton>
            </Dialog.Close>
          </Flex>

          <Text size="2" color="gray">
            {message}
          </Text>
          {cooldownUntilMs && nowMs < cooldownUntilMs ? (
            <Text size="2" color="gray">
              Try again in {Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 1000))}s.
            </Text>
          ) : null}

          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              Server
            </Text>
            <Text size="2" color="gray">
              {host}
            </Text>
          </Flex>

          <Flex direction="column" gap="2">
            <Text size="2" weight="medium">
              Password
            </Text>
            <TextField.Root
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter server password"
              disabled={submitting || (cooldownUntilMs ? Date.now() < cooldownUntilMs : false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </Flex>

          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={close} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting || (cooldownUntilMs ? Date.now() < cooldownUntilMs : false)}>
              Join
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

