/* Hallmark · component: dialog · genre: modern-minimal · theme: @gryt/ui (design.md) */
import { Alert, Button, Dialog } from "@gryt/ui";
import { useState } from "react";
import toast from "react-hot-toast";

import { openLocalArchive } from "@/common";

import { usePeerKeyCheck } from "../hooks/usePeerKeyCheck";
import { useMlsSource } from "../mls/serverMls";
import { shareHistory } from "../mls/shareHistory";

/** The code two people read to each other to check nobody is in between, opened from the chat. */
export function CompareCodesDialog({ open, onOpenChange, host, conversationId, peerId, peerName, onCall }: {
  open: boolean;
  /** The DM, for sending them your copy once a new key is trusted (GRYT-1875). */
  conversationId: string;
  onOpenChange: (open: boolean) => void;
  host: string;
  peerId: string;
  peerName: string;
  /** Starts a call with them, so the numbers can be read out loud. */
  onCall?: () => void;
}) {
  const check = usePeerKeyCheck(host, peerId);
  const [different, setDifferent] = useState(false);
  const [sharing, setSharing] = useState<"no" | "offer" | "sending">("no");
  const mlsSource = useMlsSource(host);
  const close = (next: boolean) => {
    if (!next) {
      setDifferent(false);
      setSharing("no");
    }
    onOpenChange(next);
  };
  const sendOurCopy = async () => {
    if (!mlsSource) return;
    setSharing("sending");
    try {
      const sent = await shareHistory(mlsSource, (await openLocalArchive()).messages, conversationId, peerId);
      toast.success(`Sent ${peerName} your copy: ${sent} message${sent === 1 ? "" : "s"}`);
      close(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn\u2019t send your copy");
      setSharing("offer");
    }
  };
  const groups = check.code?.split(/\s+/).filter(Boolean) ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[28rem] max-w-[calc(100vw-2rem)]" data-gryt="compare-codes">
          <Dialog.Title>Compare codes with {peerName}</Dialog.Title>
          <div className="mt-3 flex flex-col gap-3 text-sm">
            {!check.code ? (
              <p className="m-0" style={{ color: "var(--gryt-neutral-11)" }}>
                There&rsquo;s no key from {peerName} on this device yet, so there&rsquo;s nothing to compare.
              </p>
            ) : (
              <>
                <p className="m-0" style={{ lineHeight: 1.5, color: "var(--gryt-neutral-11)" }}>
                  Read these numbers to each other on a call, show them with a screen share, or compare in person. If {peerName} sees the same ones, nobody is in between.
                </p>
                <div
                  className="grid grid-cols-4 gap-y-2.5 p-4 text-center font-mono text-lg"
                  style={{ background: "var(--gryt-neutral-1)", borderRadius: "var(--gryt-radius-md)", letterSpacing: "0.04em", color: "var(--gryt-accent-12)" }}
                >
                  {groups.map((g, i) => <span key={i}>{g}</span>)}
                </div>
                {different && (
                  <Alert severity="warning">
                    Don&rsquo;t trust this key. Somebody may be between you and {peerName}. Check again on another app or in person.
                  </Alert>
                )}
                {check.comparedAt && !different ? (
                  <p className="m-0" style={{ color: "var(--gryt-neutral-11)" }}>
                    You compared codes on {new Date(check.comparedAt).toLocaleDateString()}.
                  </p>
                ) : null}
              </>
            )}
            {sharing !== "no" && (
              <div className="flex flex-col gap-2">
                <p className="m-0" style={{ lineHeight: 1.5, color: "var(--gryt-neutral-11)" }}>
                  A new key usually means {peerName}&rsquo;s old messages are gone from their side. You can send them your copy of this conversation.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button tone="neutral" onClick={() => close(false)}>Not now</Button>
                  <Button disabled={sharing === "sending"} onClick={() => void sendOurCopy()}>
                    {sharing === "sending" ? "Sending\u2026" : "Send them your copy"}
                  </Button>
                </div>
              </div>
            )}
            {sharing === "no" && <div className="flex flex-wrap justify-end gap-2">
              {onCall && check.code && (
                <Button tone="neutral" onClick={() => { onCall(); close(false); }}>Call {peerName}</Button>
              )}
              {check.code && !check.comparedAt && (
                <>
                  <Button tone="neutral" onClick={() => setDifferent(true)}>Not the same</Button>
                  <Button
                    onClick={() => {
                      if (!check.confirm()) {
                        toast.error("Their key changed while you were checking. Compare the new code.");
                        return;
                      }
                      toast.success(check.kind === "changed" ? `Trusted ${peerName}’s new key` : "Codes compared");
                      // A new key usually means their old messages are gone, so offer ours.
                      if (check.kind === "changed" && mlsSource) setSharing("offer");
                      else close(false);
                    }}
                  >
                    They match
                  </Button>
                </>
              )}
              {(!check.code || check.comparedAt) && <Button tone="neutral" onClick={() => close(false)}>Close</Button>}
            </div>}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
