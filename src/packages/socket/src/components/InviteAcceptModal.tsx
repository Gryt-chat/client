import { Alert, Avatar, Button, Dialog, IconButton, Spinner } from "@gryt/ui";
import { useEffect, useRef, useState } from "react";
import { PiEnvelopeFill, PiUsersFill, PiWarningFill, PiX } from "react-icons/pi";

import { GeneratedServerIcon, getServerHttpBase, type PendingInvite } from "@/common";

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
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup style={{ maxWidth: 420 }}>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PiEnvelopeFill size={16} />
              <Dialog.Title>Server Invite</Dialog.Title>
            </div>
            <Dialog.Close>
              <IconButton tone="ghost" size="xsmall"
                disabled={joining}
                onClick={() => {
                  if (joining) return;
                  onDismiss();
                }}
              >
                <PiX size={16} />
              </IconButton>
            </Dialog.Close>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size={24} />
            </div>
          ) : (
            <div className="flex flex-col gap-3 items-center">
              {invite && (
                <Avatar
                  size="large"
                  className="h-24 w-24 text-3xl"
                  src={`${getServerHttpBase(invite.host)}/icon`}
                  fallback={<GeneratedServerIcon seed={displayName || invite.host} />}
                />
              )}

              <div className="flex flex-col gap-1 items-center">
                <span className="text-lg font-bold">
                  {displayName}
                </span>
                {preview?.description && (
                  <span className="text-sm text-gryt-muted text-center">
                    {preview.description}
                  </span>
                )}
              </div>

              <span className="text-sm text-gryt-muted" style={{ fontFamily: "var(--code-font-family)" }}>
                {invite?.host}
              </span>

              {preview?.members && (
                <div className="flex items-center gap-1">
                  <PiUsersFill size={14} style={{ color: "var(--gryt-neutral-9)" }} />
                  <span className="text-sm text-gryt-muted">
                    {preview.members} members
                  </span>
                </div>
              )}
            </div>
          )}

          {alreadyMember ? (
            <span className="text-sm text-gryt-muted text-center">
              You are already a member of this server.
            </span>
          ) : (
            <span className="text-sm text-gryt-muted text-center">
              You&apos;ve been invited to join this server. No password required.
            </span>
          )}

          {!alreadyMember && joinError ? (
            <Alert severity="error" role="alert"><span className="inline-flex items-start gap-2"><PiWarningFill size={16} />{joinError}</span></Alert>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button tone="neutral" size="small"
              disabled={joining}
              onClick={() => {
                if (joining) return;
                onDismiss();
              }}
            >
              {alreadyMember ? "Dismiss" : "Cancel"}
            </Button>
            {alreadyMember ? (
              <Button size="small" onClick={() => onGoToServer?.()}>Go to Server</Button>
            ) : (
              <Button size="small"
                onClick={() => {
                  void onAccept();
                }}
                disabled={loading || joining}
              >
                {joining ? (
                  <>
                    <Spinner size={20} /> Joining…
                  </>
                ) : (
                  "Accept Invite"
                )}
              </Button>
            )}
          </div>
        </div>
      </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
