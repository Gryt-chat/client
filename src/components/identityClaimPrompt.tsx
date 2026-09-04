import { Button, Dialog } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";

import { getClaimDecision, hasGuestScope, identityScopeFor, useAccount } from "@/common";
import { useServerManagement } from "@/socket";

import { useIdentityClaim } from "../hooks/useIdentityClaim";

/**
 * Asked per server, when you are signed in and have been a guest here before
 * (GRYT-285). One question after signing in authorised every guest identity on
 * the device at once, including servers joined later.
 *
 * **The proof that an account controls a guest identity is also the
 * disclosure**, so once it reaches the server, declining changes nothing. The
 * question has to be answerable locally, which is what `hasGuestScope` is for.
 *
 * A yes takes effect by reconnecting: `answerChallenge` reads the decision, and
 * dropping the token puts the next connect back on the join path (GRYT-286).
 */
export function IdentityClaimPrompt() {
  const { isSignedIn } = useAccount();
  const { currentlyViewingServer } = useServerManagement();
  const { claim, decline } = useIdentityClaim();
  const host = currentlyViewingServer?.host ?? null;
  const [asking, setAsking] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || !host) {
      setAsking(null);
      return;
    }
    const scope = identityScopeFor(host);
    // Been here as a guest, and nobody has said either way yet.
    setAsking(hasGuestScope(scope) && getClaimDecision(scope) === null ? host : null);
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

  return (
    /* No onOpenChange. Dismissing without answering would leave the server
       undecided and ask again on the next visit, which is a worse experience
       than answering once. */
    <Dialog.Root open={asking !== null}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[27.5rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>Use your previous membership here?</Dialog.Title>
          <Dialog.Description className="mt-2 mb-3">
            You used this server before signing in. Gryt can attach that
            membership to your account, so you keep your roles, anything you own
            and the history attached to it.
          </Dialog.Description>
          <p className="mb-4 text-sm text-gryt-muted">
            Only do this if that was you. On a shared computer the previous
            membership belongs to whoever used it last.
          </p>
          <div className="flex justify-end gap-2">
            <Button tone="neutral" size="small" onClick={() => answer("no")}>
              Keep separate
            </Button>
            <Button size="small" onClick={() => answer("yes")}>
              Use previous membership
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
