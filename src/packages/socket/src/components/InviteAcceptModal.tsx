import { Button, Dialog, Flex, IconButton, Spinner, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { MdClose, MdGroup, MdMail } from "react-icons/md";
import { io, Socket } from "socket.io-client";

import { getServerWsBase, type PendingInvite } from "@/common";

type ServerPreview = {
  name: string;
  description?: string;
  members?: string;
};

interface InviteAcceptModalProps {
  invite: PendingInvite | null;
  onAccept: () => void;
  onDismiss: () => void;
}

export function InviteAcceptModal({ invite, onAccept, onDismiss }: InviteAcceptModalProps) {
  const [preview, setPreview] = useState<ServerPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!invite) {
      setPreview(null);
      cleanup();
      return;
    }

    setLoading(true);
    setPreview(null);

    const wsBase = getServerWsBase(invite.host);
    const sock = io(wsBase, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 8000,
    });
    socketRef.current = sock;

    sock.on("connect", () => {
      sock.emit("server:info");
    });

    sock.on("server:info", (data: { name?: string; description?: string; members?: string }) => {
      setPreview({
        name: data.name || invite.host,
        description: data.description,
        members: data.members,
      });
      setLoading(false);
    });

    sock.on("connect_error", () => {
      setPreview({ name: invite.host });
      setLoading(false);
    });

    const fallbackTimeout = setTimeout(() => {
      if (!preview) {
        setPreview({ name: invite.host });
        setLoading(false);
      }
    }, 5000);

    return () => {
      clearTimeout(fallbackTimeout);
      cleanup();
    };
    // Only re-run when the invite changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invite?.host, invite?.code]);

  const isOpen = invite !== null;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Content style={{ maxWidth: 420 }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Flex align="center" gap="2">
              <MdMail size={16} />
              <Dialog.Title>Server Invite</Dialog.Title>
            </Flex>
            <Dialog.Close>
              <IconButton variant="ghost" color="gray" onClick={onDismiss}>
                <MdClose size={16} />
              </IconButton>
            </Dialog.Close>
          </Flex>

          {loading ? (
            <Flex align="center" justify="center" py="6">
              <Spinner size="3" />
            </Flex>
          ) : (
            <Flex direction="column" gap="3">
              <Flex direction="column" gap="1">
                <Text size="4" weight="bold">
                  {preview?.name || invite?.host}
                </Text>
                {preview?.description && (
                  <Text size="2" color="gray">
                    {preview.description}
                  </Text>
                )}
              </Flex>

              <Flex align="center" gap="2">
                <Text size="2" color="gray" style={{ fontFamily: "var(--code-font-family)" }}>
                  {invite?.host}
                </Text>
              </Flex>

              {preview?.members && (
                <Flex align="center" gap="1">
                  <MdGroup size={14} style={{ color: "var(--gray-9)" }} />
                  <Text size="2" color="gray">
                    {preview.members} online
                  </Text>
                </Flex>
              )}
            </Flex>
          )}

          <Text size="2" color="gray">
            You&apos;ve been invited to join this server. No password required.
          </Text>

          <Flex justify="end" gap="2">
            <Button variant="soft" color="gray" onClick={onDismiss}>
              Cancel
            </Button>
            <Button onClick={onAccept} disabled={loading}>
              Accept Invite
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
