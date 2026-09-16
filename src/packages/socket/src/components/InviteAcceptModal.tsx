import { Alert, Avatar, Button, Dialog, IconButton, Spinner, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import { GeneratedServerIcon, getServerHttpBase, normalizeCode, type PendingInvite } from "@/common";
import {
  type FetchInfo,
  fetchServerInfo,
  type InfoResult,
  type JoinOutcome,
} from "@/settings/src/hooks/useServerJoin";

import { PiEnvelopeFill, PiSignInFill, PiUsersFill, PiWarningFill, PiX } from "../../../../lib/icons";
import { type InviteDialogMessage, inviteDialogView } from "../lib/inviteDialog";

export interface InviteJoinRequest {
  code: string;
  info: FetchInfo | null;
  note?: string;
}

interface InviteAcceptModalProps {
  invite: PendingInvite | null;
  alreadyMember?: boolean;
  /** Undefined until the account check answers. */
  isSignedIn?: boolean;
  signingIn?: boolean;
  onSignIn: () => void;
  onJoin: (request: InviteJoinRequest) => Promise<JoinOutcome>;
  onDismiss: () => void;
  onGoToServer?: () => void;
}

type Lookup = { kind: "loading" } | Exclude<InfoResult, { kind: "superseded" }>;

const MESSAGES: Record<InviteDialogMessage, string> = {
  member: "You're already a member of this server.",
  invited: "You've been invited to join this server. No password required.",
  "needs-code": "This server needs an invite code.",
  request: "Somebody who runs this server has to let you in.",
  open: "Anyone can join this server.",
  private: "This server doesn't share its details. You can still try to join.",
  none: "",
};

export function InviteAcceptModal({
  invite,
  alreadyMember = false,
  isSignedIn,
  signingIn = false,
  onSignIn,
  onJoin,
  onDismiss,
  onGoToServer,
}: InviteAcceptModalProps) {
  const host = invite?.host ?? "";
  const linkCode = invite?.code ?? "";

  const [lookup, setLookup] = useState<Lookup>({ kind: "loading" });
  const [typedCode, setTypedCode] = useState("");
  const [note, setNote] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [inviteRequired, setInviteRequired] = useState(false);
  const [accountRequired, setAccountRequired] = useState(false);
  const [awaitingApproval, setAwaitingApproval] = useState(false);

  useEffect(() => {
    setTypedCode("");
    setNote("");
    setJoinError("");
    setInviteRequired(false);
    setAccountRequired(false);
    setAwaitingApproval(false);
    if (!host) return;

    setLookup({ kind: "loading" });
    const controller = new AbortController();
    void fetchServerInfo(host, controller.signal).then((result) => {
      if (controller.signal.aborted || result.kind === "superseded") return;
      setLookup(result);
    });
    return () => controller.abort();
  }, [host, linkCode]);

  const info = lookup.kind === "info" ? lookup.info : null;
  const view = inviteDialogView({
    linkCode,
    typedCode,
    lookup: lookup.kind,
    info,
    isSignedIn,
    alreadyMember,
    inviteRequired,
    accountRequired,
    awaitingApproval,
  });

  const displayName = info?.name || host;
  const message = MESSAGES[view.message];

  async function join() {
    if (joining) return;
    setJoining(true);
    setJoinError("");
    try {
      const outcome = await onJoin({ code: view.code, info, note: note.trim() || undefined });
      if (outcome.ok) return;
      if (outcome.kind === "approval_pending") {
        setAwaitingApproval(true);
        return;
      }
      if (outcome.kind === "invite_required") setInviteRequired(true);
      if (outcome.kind === "account_required") setAccountRequired(true);
      setJoinError(outcome.message);
    } finally {
      setJoining(false);
    }
  }

  function dismiss() {
    if (joining) return;
    onDismiss();
  }

  return (
    <Dialog.Root
      open={invite !== null}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[26.25rem]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PiEnvelopeFill size={16} />
              <Dialog.Title>Server Invite</Dialog.Title>
            </div>
            <Dialog.Close
              disabled={joining}
              render={<IconButton tone="ghost" size="xsmall" aria-label="Close" />}
            >
              <PiX size={16} />
            </Dialog.Close>
          </div>

          {lookup.kind === "loading" ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size={24} />
            </div>
          ) : (
            <div className="flex flex-col gap-3 items-center">
              {invite && (
                <Avatar
                  size="large"
                  className="h-24 w-24 text-3xl"
                  src={info ? `${getServerHttpBase(invite.host)}/icon` : undefined}
                  fallback={<GeneratedServerIcon seed={displayName || invite.host} />}
                />
              )}

              <div className="flex flex-col gap-1 items-center">
                <span className="text-lg font-bold">
                  {displayName}
                </span>
                {info?.description && (
                  <span className="text-sm text-gryt-muted text-center">
                    {info.description}
                  </span>
                )}
              </div>

              <span className="text-sm text-gryt-muted" style={{ fontFamily: "var(--code-font-family)" }}>
                {invite?.host}
              </span>

              {info?.members && (
                <div className="flex items-center gap-1">
                  <PiUsersFill size={14} style={{ color: "var(--gryt-neutral-9)" }} />
                  <span className="text-sm text-gryt-muted">
                    {info.members} members
                  </span>
                </div>
              )}
            </div>
          )}

          {lookup.kind === "error" && !alreadyMember && (
            <span className="text-sm text-gryt-muted text-center">{lookup.message}</span>
          )}

          {message && lookup.kind !== "loading" && (
            <span className="text-sm text-gryt-muted text-center">
              {message}
            </span>
          )}

          {view.needsAccount && !alreadyMember && (
            <span className="text-sm text-center">
              You need a Gryt account to join. Sign in and you&rsquo;ll come back to this invite.
            </span>
          )}

          {view.showCodeField && !awaitingApproval && (
            <TextField
              aria-label="Invite code"
              placeholder="Paste invite code"
              disabled={joining}
              value={typedCode}
              onChange={(e) => setTypedCode(normalizeCode(e.target.value))}
            />
          )}

          {view.showNote && (
            <TextField
              aria-label="Say who you are"
              placeholder="Say who you are (optional)"
              maxLength={300}
              disabled={joining}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}

          {awaitingApproval && (
            <Alert severity="info">
              Asked. Somebody who runs this server has to let you in. It&rsquo;s in your server
              list now, marked as waiting, and opens on its own once they do.
            </Alert>
          )}

          {!alreadyMember && joinError && !view.needsAccount ? (
            <Alert severity="error" role="alert"><span className="inline-flex items-start gap-2"><PiWarningFill size={16} />{joinError}</span></Alert>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button tone="neutral" size="small" disabled={joining} onClick={dismiss}>
              {alreadyMember || awaitingApproval ? "Close" : "Cancel"}
            </Button>
            {view.action.kind === "go-to-server" && (
              <Button size="small" onClick={() => onGoToServer?.()}>Go to Server</Button>
            )}
            {view.action.kind === "sign-in" && (
              <Button size="small" disabled={signingIn} onClick={onSignIn}>
                <PiSignInFill size={16} />
                {signingIn ? "Signing in…" : "Sign in to join"}
              </Button>
            )}
            {view.action.kind === "join" && (
              <Button size="small" disabled={view.action.disabled || joining} onClick={() => void join()}>
                {joining ? (
                  <>
                    <Spinner size={20} /> Joining…
                  </>
                ) : (
                  view.action.label
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
