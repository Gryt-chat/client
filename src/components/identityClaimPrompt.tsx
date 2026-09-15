import { Button, Dialog } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const popup = useRef<HTMLDivElement>(null);

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

  const serverName = currentlyViewingServer?.name || asking;

  return (
    <Dialog.Root open={asking !== null} onOpenChange={(open) => !open && postpone()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        {/* Focus starts on the card, not a button: Yes can't be undone, and focusing
            the last button scrolls a short window past the question. */}
        <Dialog.Popup
          ref={popup}
          initialFocus={popup}
          className="w-[36rem] max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto outline-none"
        >
          <Dialog.Title>Were you here as a guest before?</Dialog.Title>
          <Dialog.Description className="mt-2 mb-3">
            Someone on this device used{" "}
            <span className="text-gryt-text">{serverName}</span> as a guest
            before you signed in.
            {lastUsed !== null && <> The last time was {formatLastUsed(lastUsed)}.</>}
          </Dialog.Description>
          <p className="mb-3 text-sm">
            You can move that guest to your account. Your account then gets the
            guest&rsquo;s name, picture, roles and messages on this server. If
            the guest owns the server, your account will own it instead.
          </p>
          <p className="mb-3 text-sm text-gryt-muted">
            Only say yes if that was you. On a shared computer, it might be
            someone else. You can&rsquo;t undo this, and the server will know
            the guest was you.
          </p>
          <p className="mb-4 text-sm text-gryt-muted">
            If you say no, the guest and your account stay separate. You can
            still move it later by right-clicking the server and picking
            &ldquo;I&rsquo;ve used this server before&rdquo;.
          </p>
          {/* Stacked with Yes on top when the card is narrow. In the DOM, Ask me
              later comes first, so Tab reaches it before either answer. */}
          <div className="@container">
            <div className="flex flex-col-reverse gap-2 @min-[33rem]:flex-row @min-[33rem]:flex-wrap @min-[33rem]:items-center @min-[33rem]:justify-end">
              <Button tone="ghost" size="small" className="@min-[33rem]:mr-auto" onClick={postpone}>
                Ask me later
              </Button>
              <Button tone="neutral" size="small" onClick={() => answer("no")}>
                No, keep them separate
              </Button>
              <Button size="small" onClick={() => answer("yes")}>
                Yes, move it to my account
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
