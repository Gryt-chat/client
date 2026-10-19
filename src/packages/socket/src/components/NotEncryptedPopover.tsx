import { Button, Popover } from "@gryt/ui";
import { useState } from "react";

import type { SealDecision } from "@/common";

import { PiShieldSlashFill } from "../../../../lib/icons";
import { setMarksHidden, useMarksHidden } from "../lib/unencryptedMarks";

function whyNotEncrypted(s: { changedWho: string | null; unusable: boolean; who: string | null; serverName: string }): string {
  if (s.changedWho) {
    return `${s.changedWho}’s app is using a different key than last time. That’s normal after a reinstall or a new phone. It’s also what somebody pretending to be them would look like, so nothing is encrypted to it until you say so.`;
  }
  const readable = `Whoever runs ${s.serverName} can read what you send here.`;
  if (s.unusable) return `${readable} ${s.who}’s key didn’t check out, which usually means their app is too old for this.`;
  return s.who ? `${readable} ${s.who}’s app hasn’t set up a key for this server yet.` : readable;
}

/**
 * "Not encrypted" in a DM's header, and what clicking it says (boards 5b, 5c): why, what
 * can be done about it, and turning off the dots on each message here.
 */
export function NotEncryptedPopover({
  decision,
  serverName,
  host,
  conversationId,
  memberNames,
  onAsk,
  onCompare,
}: {
  decision: SealDecision | undefined;
  serverName: string;
  host: string;
  conversationId: string;
  memberNames: Record<string, string>;
  /** Sends the one short message asking them to update. */
  onAsk: (text: string) => void;
  /** Opens their card, where the comparison code is. */
  onCompare: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const hidden = useMarksHidden(host, conversationId);
  const blocked = decision?.kind === "plaintext" ? decision.blockedBy : [];
  const first = blocked[0];
  const who = first ? memberNames[first.memberId] ?? "Somebody here" : null;
  const changed = blocked.find((b) => b.reason === "changed");
  const changedWho = changed ? memberNames[changed.memberId] ?? "Somebody here" : null;

  const why = whyNotEncrypted({ changedWho, unusable: first?.reason === "unusable", who, serverName });

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={<button type="button" aria-label="Not encrypted. Why, and what to do" />}
        className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs underline decoration-dotted underline-offset-2"
        style={{ color: "var(--gryt-danger-11)" }}
      >
        <PiShieldSlashFill size={11} aria-hidden /> Not encrypted
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8}>
          <Popover.Popup className="flex w-96 flex-col gap-2.5 p-4" data-gryt="not-encrypted">
            <span className="text-[15px] font-bold" style={{ color: "var(--gryt-danger-11)" }}>
              {changedWho ? `Not encrypted: ${changedWho}’s key changed` : "Not encrypted"}
            </span>
            <p className="m-0 text-[13px]" style={{ lineHeight: 1.5, color: "var(--gryt-neutral-11)" }}>{why}</p>

            {blocked.length > 0 && (
              <>
                <span className="mt-1 text-xs font-bold">What can I do?</span>
                {changedWho ? (
                  <>
                    <p className="m-0 text-[13px]" style={{ lineHeight: 1.5, color: "var(--gryt-neutral-11)" }}>
                      Ask {changedWho}, somewhere other than Gryt, to read you the code on their card. If it matches yours, the key is theirs.
                    </p>
                    <div className="flex gap-2">
                      <Button size="small" onClick={() => { setOpen(false); onCompare(); }}>Compare codes</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="m-0 text-[13px]" style={{ lineHeight: 1.5, color: "var(--gryt-neutral-11)" }}>
                      Nothing on your side. {who}&rsquo;s app sets up a key by itself the next time they open an up-to-date Gryt. When it does, this conversation switches to encrypted on its own, and a line in it says so.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="small"
                        disabled={asked}
                        onClick={() => {
                          setAsked(true);
                          onAsk("Could you update Gryt when you get a chance? Our messages here can’t be encrypted until your app sets up a key.");
                        }}
                      >
                        {asked ? "Asked" : `Ask ${who} to update`}
                      </Button>
                    </div>
                    <span className="text-[11px]" style={{ lineHeight: 1.4, color: "var(--gryt-neutral-10)" }}>
                      Sends them one short message saying why. It isn&rsquo;t encrypted either.
                    </span>
                  </>
                )}
              </>
            )}

            <div className="my-1 h-px" style={{ background: "var(--gryt-neutral-6)" }} />
            <div className="flex items-center gap-2.5">
              <Button size="xsmall" tone="ghost" onClick={() => setMarksHidden(host, conversationId, !hidden)}>
                {hidden ? "Mark messages here again" : "Stop marking messages here"}
              </Button>
              <span className="text-[11px]" style={{ lineHeight: 1.4, color: "var(--gryt-neutral-10)" }}>The header keeps saying it.</span>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
