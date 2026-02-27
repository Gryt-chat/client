import { Avatar, Button, Callout, Dialog, Flex, IconButton, Spinner, Text } from "@radix-ui/themes";
import { useEffect, useRef, useState } from "react";
import { MdClose, MdGroup, MdMail, MdWarning } from "react-icons/md";

import { getServerHttpBase, type PendingInvite } from "@/common";

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
  const abortRef = useRef<AbortController | null>(null);

  const host = invite?.host ?? "";
  const code = invite?.code ?? "";

  useEffect(() => {
    if (!host) {
      setPreview(null);
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }

    setLoading(true);
    setPreview(null);

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const httpBase = getServerHttpBase(host);
    fetch(`${httpBase}/info`, { signal: ac.signal })
      .then((r) => (r.ok ? (r.json() as Promise<ServerPreview>) : Promise.reject()))
      .then((data) => {
        setPreview({
          name: data.name || host,
          description: data.description,
          members: data.members,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setPreview({ name: host });
      })
      .finally(() => setLoading(false));

    return () => ac.abort();
  }, [host, code]);

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
                    {preview.members} members
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
