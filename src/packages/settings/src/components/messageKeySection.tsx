import { Alert, Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

import {
  getAccountProfile,
  guestIdentitiesAtRisk,
  hasMessageKeyHere,
  rememberMessageKeyHere,
  restoreIdentityFromWords,
} from "@/common";

import { useLinkDevice } from "../../../../lib/pairing/useLinkDevice";
import { generateSeed, seedToWords } from "../../../common/src/auth/identity-seed";
import { phraseMatches } from "../../../socket/src/lib/confirmPhrase";
import { AccountWordsReveal } from "./recoveryWords";

/** The message key, for signed-in accounts. */

/**
 * Typed back before the key is replaced. Named once so the check and the label
 * cannot drift, which is how they came to disagree.
 */
const RESET_PHRASE = "start again";

// Adopting drops every server session and clears the derived keys, so sending
// breaks until a restart, not only reading. GRYT-1068.
function showAdoptedToast(lead: string): void {
  toast.success(
    () => (
      <div className="flex flex-col gap-2" style={{ minWidth: 0 }}>
        <span className="text-sm" style={{ lineHeight: 1.5 }}>
          {lead} Gryt has to restart before it can send or read encrypted
          messages again.
        </span>
        <Button
          size="small"
          style={{ alignSelf: "flex-end" }}
          onClick={() => window.location.reload()}
        >
          Restart now
        </Button>
      </div>
    ),
    { duration: 30000 },
  );
}

export function MessageKeySection() {
  const [open, setOpen] = useState<"reset" | null>(null);
  const [keyIsHere, setKeyIsHere] = useState(false);
  const [confirmReset, setConfirmReset] = useState("");
  const [resetWords, setResetWords] = useState(false);
  const [busy, setBusy] = useState(false);
  const { open: openLinkDevice } = useLinkDevice();

  useEffect(() => {
    let cancelled = false;
    getAccountProfile()
      .then((p) => { if (!cancelled && p.sub) setKeyIsHere(hasMessageKeyHere(p.sub)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const close = useCallback(() => {
    setOpen(null);
    setConfirmReset("");
    setResetWords(false);
  }, []);

  /** A new key, for a device whose key nobody else has anymore. */
  const reset = useCallback(async () => {
    if (!phraseMatches(confirmReset, RESET_PHRASE)) {
      return toast.error(`Type "${RESET_PHRASE}" to confirm.`);
    }

    setBusy(true);
    try {
      await restoreIdentityFromWords(seedToWords(generateSeed()));
      const sub = await getAccountProfile().then((p) => p.sub).catch(() => null);
      if (sub) rememberMessageKeyHere(sub);
      setKeyIsHere(true);
      close();
      showAdoptedToast("New message key set. Older conversations stay unreadable.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not reset the message key.");
    } finally {
      setBusy(false);
    }
  }, [confirmReset, close]);

  const guests = guestIdentitiesAtRisk();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-sm">Your message key</span>
        <span className="text-xs text-gryt-muted">
          Your messages are encrypted with a key that lives on your devices. A new
          device gets it when you approve it from one you already use, or from your
          24 words.
        </span>
      </div>

      {keyIsHere && !open && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm">Your 24 words</span>
            <span className="text-xs text-gryt-muted">
              Your message key, written out as 24 words.
            </span>
          </div>
          <AccountWordsReveal keyIsHere={keyIsHere} />
        </div>
      )}

      {keyIsHere && !open && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gryt-muted">
            Set this device up from your 24 words? Your messages come over when you link it to
            a device you already use.
          </span>
          <Button size="small" tone="neutral" style={{ alignSelf: "flex-start" }} onClick={openLinkDevice}>
            Bring my messages from another device
          </Button>
        </div>
      )}

      {!open && (
        <div>
          <Button tone="ghost" size="small" onClick={() => setOpen("reset")}>
            Start again with a new key
          </Button>
        </div>
      )}

      {open === "reset" && (
        <div className="flex flex-col gap-3">
          <Alert severity="error">
            <div className="flex flex-col gap-2">
              <span>
                This makes a new message key. Everything already sealed with the
                old one stays unreadable &mdash; on this device and every other.
                Nobody can undo it, including us. That is the same property that
                stops us reading your messages in the first place.
              </span>
              {/* Three cases, and the third is the one that matters: no record of guest
                  servers doesn't mean there are none. */}
              {guests.certain ? (
                <span>
                  <strong>
                    It also replaces your identity on {guests.count} server
                    {guests.count === 1 ? "" : "s"} you joined without an
                    account.
                  </strong>{" "}
                  You would arrive there as a stranger, and any roles or
                  ownership you had are gone with no way back.{" "}
                  <SaveWordsFirst keyIsHere={keyIsHere} onClick={() => setResetWords(true)} />
                </span>
              ) : (
                <span>
                  <strong>
                    It also replaces your identity on any server you joined
                    without an account.
                  </strong>{" "}
                  This device has no record of those, which does not mean there
                  are none &mdash; a device set up from a 24-word phrase never
                  has one. You would arrive at any such server as a stranger,
                  and any roles or ownership there are gone with no way back.{" "}
                  <SaveWordsFirst keyIsHere={keyIsHere} onClick={() => setResetWords(true)} />
                </span>
              )}
            </div>
          </Alert>

          {resetWords && <AccountWordsReveal keyIsHere={keyIsHere} startAt="confirming" />}

          <TextField
            label={`Type \u201c${RESET_PHRASE}\u201d to confirm`}
            value={confirmReset}
            onChange={(e) => setConfirmReset(e.target.value)}
          />
          <div className="flex gap-2">
            <Button size="small" tone="danger" onClick={() => void reset()} disabled={busy}>
              Start again
            </Button>
            <Button tone="neutral" size="small" onClick={close} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

    </div>
  );
}

/** The reset warning's advice, as a link where this device can actually show the words. */
function SaveWordsFirst({ keyIsHere, onClick }: { keyIsHere: boolean; onClick(): void }) {
  if (!keyIsHere) return <>Save your 24 words first if you want to keep them.</>;
  return (
    <>
      <button
        type="button"
        className="cursor-pointer appearance-none border-0 bg-transparent p-0 text-inherit underline"
        onClick={onClick}
      >
        Save your 24 words first
      </button>{" "}
      if you want to keep them.
    </>
  );
}
