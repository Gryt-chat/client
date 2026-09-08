import { Button, Dialog } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { getClaimDecision, getGuestVisit, identityScopeFor, useAccount } from "@/common";
import { useServerManagement } from "@/socket";

import { useIdentityClaim } from "../hooks/useIdentityClaim";

/**
 * Asked per server, when you are signed in and have been a guest here before.
 * **The proof is also the disclosure**, so the question has to be local (GRYT-285).
 */
export function IdentityClaimPrompt() {
  const { isSignedIn } = useAccount();
  const { currentlyViewingServer } = useServerManagement();
  const { claim, decline } = useIdentityClaim();
  const host = currentlyViewingServer?.host ?? null;
  const [asking, setAsking] = useState<string | null>(null);
  const [lastUsed, setLastUsed] = useState<number | null>(null);

  useEffect(() => {
    if (!isSignedIn || !host) {
      setAsking(null);
      return;
    }
    const scope = identityScopeFor(host);
    const visit = getGuestVisit(scope);
    // Been here as a guest, nobody has said either way, and it has not already
    // been waved off this session.
    const ask = Boolean(visit) && getClaimDecision(scope) === null && !postponed.has(scope);
    setLastUsed(visit?.lastUsed ?? null);
    setAsking(ask ? host : null);
  }, [isSignedIn, host]);

  const answer = useCallback(
    (decision: "yes" | "no") => {
      if (!asking) return;
      const host = asking;
      setAsking(null);
      if (decision === "yes") claim(host);
      else decline(host);
    },
    [asking, claim, decline],
  );

  /**
   * Dismissing is "not now", not "no". Nothing is stored, because nothing has been
   * disclosed. Suppressed for the session, offered again on the next launch.
   */
  const postpone = useCallback(() => {
    if (asking) postponed.add(identityScopeFor(asking));
    setAsking(null);
  }, [asking]);

  return (
    <Dialog.Root open={asking !== null} onOpenChange={(open) => !open && postpone()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[27.5rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>You already have a user on this server</Dialog.Title>
          <Dialog.Description className="mt-2 mb-3">
            Before you signed in, this device used{" "}
            <span className="text-gryt-text">{asking}</span> as a guest.
            {lastUsed !== null && <> Last used {formatLastUsed(lastUsed)}.</>}
          </Dialog.Description>
          <p className="mb-3 text-sm">
            Should that user become your account here? It keeps its roles,
            anything it owns and its history.
          </p>
          <p className="mb-3 text-sm text-gryt-muted">
            Only say yes if that user was you. On a shared computer it belongs to
            whoever used it last. You can&rsquo;t undo it. Saying yes tells the
            server that your account and that user are the same person.
          </p>
          <p className="mb-4 text-sm text-gryt-muted">
            Starting fresh is safe. You can convert the old user later from the
            server menu.
          </p>
          {/* "Ask me later" sits away from the two answers, because it is not a
              third answer. Visible rather than only on Esc: a way out nobody
              can see is one nobody takes, which is how this became a dialog you
              had to answer to carry on reading. */}
          <div className="flex items-center justify-between gap-2">
            <Button tone="ghost" size="small" onClick={postpone}>
              Ask me later
            </Button>
            <div className="flex gap-2">
              <Button tone="neutral" size="small" onClick={() => answer("no")}>
                No, this is a new user
              </Button>
              <Button size="small" onClick={() => answer("yes")}>
                Yes, convert my user
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Scopes waved off since launch. Deliberately not persisted. */
const postponed = new Set<string>();

/**
 * The date, in the reader's locale. The year appears only when it is not this
 * one, so the common case reads "12 August".
 */
function formatLastUsed(epochMs: number): string {
  const date = new Date(epochMs);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
