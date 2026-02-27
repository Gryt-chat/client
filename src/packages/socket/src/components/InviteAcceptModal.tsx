import { Avatar, Button, Callout, Dialog, Flex, IconButton, Spinner, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import { MdClose, MdGroup, MdMail, MdWarning } from "react-icons/md";
import { io, Socket } from "socket.io-client";

import { getServerHttpBase, getServerWsBase, type PendingInvite } from "@/common";

type ServerPreview = {
  name: string;
  description?: string;
  members?: string;
};

interface InviteAcceptModalProps {
  invite: PendingInvite | null;
  joining?: boolean;
  joinError?: string;
  alreadyMember?: boolean;
  onAccept: () => void | Promise<void>;
  onDismiss: () => void;
  onGoToServer?: () => void;
}

export function InviteAcceptModal({
  invite,
  joining = false,
  joinError,
  alreadyMember = false,
  onAccept,
  onDismiss,
  onGoToServer,
}: InviteAcceptModalProps) {
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
    console.log(`[InvitePreview] Connecting to ${invite.host} (${wsBase})…`);
    const sock = io(wsBase, {
      reconnection: false,
      timeout: 8000,
    });
    socketRef.current = sock;

    sock.on("connect", () => {
      console.log(`[InvitePreview] Connected to ${invite.host}`);
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

    sock.on("connect_error", (err) => {
      console.warn(`[InvitePreview] connect_error for ${invite.host}:`, err?.message || err);
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
  const displayName = preview?.name || invite?.host || "";

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (joining) return;
          onDismiss();
        }
      }}
    >
      <Dialog.Content style={{ maxWidth: 420 }}>
        <Flex direction="column" gap="4">
          <Flex align="center" justify="between">
            <Flex align="center" gap="2">
              <MdMail size={16} />
              <Dialog.Title>Server Invite</Dialog.Title>
            </Flex>
            <Dialog.Close>
              <IconButton
                variant="ghost"
                color="gray"
                disabled={joining}
                onClick={() => {
                  if (joining) return;
                  onDismiss();
                }}
              >
                <MdClose size={16} />
              </IconButton>
            </Dialog.Close>
          </Flex>

          {loading ? (
            <Flex align="center" justify="center" py="6">
              <Spinner size="3" />
            </Flex>
          ) : (
            <Flex direction="column" gap="3" align="center">
              {invite && (
                <Avatar
                  size="7"
                  radius="full"
                  src={`${getServerHttpBase(invite.host)}/icon`}
                  fallback={displayName[0]?.toUpperCase() || "S"}
                />
              )}

              <Flex direction="column" gap="1" align="center">
                <Text size="4" weight="bold">
                  {displayName}
                </Text>
                {preview?.description && (
                  <Text size="2" color="gray" align="center">
                    {preview.description}
                  </Text>
                )}
              </Flex>

              <Text size="2" color="gray" style={{ fontFamily: "var(--code-font-family)" }}>
                {invite?.host}
              </Text>

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

          {alreadyMember ? (
            <Text size="2" color="gray" align="center">
              You are already a member of this server.
            </Text>
          ) : (
            <Text size="2" color="gray" align="center">
              You&apos;ve been invited to join this server. No password required.
            </Text>
          )}

          {!alreadyMember && joinError ? (
            <Callout.Root color="red" role="alert">
              <Callout.Icon>
                <MdWarning size={16} />
              </Callout.Icon>
              <Callout.Text>{joinError}</Callout.Text>
            </Callout.Root>
          ) : null}

          <Flex justify="end" gap="2">
            <Button
              variant="soft"
              color="gray"
              disabled={joining}
              onClick={() => {
                if (joining) return;
                onDismiss();
              }}
            >
              {alreadyMember ? "Dismiss" : "Cancel"}
            </Button>
            {alreadyMember ? (
              <Button onClick={() => onGoToServer?.()}>Go to Server</Button>
            ) : (
              <Button
                onClick={() => {
                  void onAccept();
                }}
                disabled={loading || joining}
              >
                {joining ? (
                  <>
                    <Spinner size="2" /> Joining…
                  </>
                ) : (
                  "Accept Invite"
                )}
              </Button>
            )}
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
