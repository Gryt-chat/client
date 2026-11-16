/* Hallmark · component: notice · genre: modern-minimal · theme: @gryt/ui (design.md)
 * states: ask · waiting · denied · resetting · done; buttons carry their own states. */
import { Button } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

import { PiCheckBold, PiLockFill } from "../../../../lib/icons";
import { keyResets, movedToThisKey, ownHandover } from "../mls/keyHandover";
import { keyHolderHere, moveServerToThisKey, requestKeyReset } from "../mls/serverMls";

const PHONES = /^(iPhone|iPad|Android phone|Android tablet)$/;

function who(name: string | null): string {
  if (!name) return "another of your devices";
  return PHONES.test(name) ? `your ${name}` : name;
}

const that = (name: string | null) => (name && PHONES.test(name) ? `that ${name}` : "that device");
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function Card({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  const [why, setWhy] = useState(false);
  return (
    <div role="status" aria-live="polite" className="mb-2 flex flex-col gap-2.5 rounded-[14px] border border-gryt-border bg-gryt-bg px-4 py-3.5">
      <div className="flex items-start gap-2.5">
        <PiLockFill aria-hidden="true" size={16} className="mt-0.5 shrink-0" style={{ color: "var(--gryt-accent-9)" }} />
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm leading-normal">
          <span className="font-bold">{title}</span>
          {children}
          {why && (
            <span className="text-gryt-muted">
              Gryt uses one key for all your devices. This server still has the key from an older device, so that
              device has to say this one is yours. Someone with only your password can&rsquo;t get past this.
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="What's this?"
          aria-expanded={why}
          onClick={() => setWhy(!why)}
          className="flex size-6 shrink-0 items-center justify-center rounded-full border border-gryt-border text-xs font-bold text-gryt-muted hover:text-gryt-text"
        >
          ?
        </button>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pl-[26px]">{actions}</div>}
    </div>
  );
}

/** A server that still has an older device's key, on the device that holds the account's. One button, and it says who approves. */
export function OldKeyNotice({ host, serverName, peerName }: { host: string; serverName: string; peerName: string }) {
  const handover = ownHandover.use()[host];
  const reset = keyResets.use()[host];
  const moved = movedToThisKey.use().includes(host);
  const [holder, setHolder] = useState<{ holder: string | null; seenAt: number | null } | null>(null);
  const [resetAt, setResetAt] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void keyHolderHere(host).then((h) => { if (live) setHolder(h); });
    return () => { live = false; };
  }, [host]);

  const name = handover?.holder ?? holder?.holder ?? null;
  const seenAt = handover?.seenAt ?? holder?.seenAt ?? null;
  // Asking also starts the server's 30-day clock, so waiting wins until you say the device is gone.
  const waiting = !!handover && !handover.denied && resetAt === null;
  const takesOverAt = resetAt ?? (!waiting && reset && !reset.holdsCurrentKey ? reset.at : null);

  const move = () => {
    moveServerToThisKey(host);
    setTimeout(() => {
      if (!ownHandover.get()[host]) toast.error(`Couldn't reach ${serverName}. Try again in a moment.`);
    }, 4000);
  };

  const giveUp = async () => {
    if (busy) return;
    setBusy(true);
    const at = await requestKeyReset(host);
    setBusy(false);
    if (at) setResetAt(at);
    else toast.error(`${serverName} didn't take that. Try again in a moment.`);
  };

  if (moved) {
    return (
      <div role="status" className="mb-1.5 flex items-center gap-2 px-1 text-xs" style={{ color: "var(--gryt-neutral-11)" }}>
        <PiCheckBold aria-hidden="true" size={14} style={{ color: "var(--gryt-success-9)" }} />
        DMs on {serverName} work on this device now.
      </div>
    );
  }
  if (dismissed) return null;

  if (takesOverAt && !waiting) {
    return (
      <Card
        title={`DMs on ${serverName} work here from ${day(takesOverAt)}`}
        actions={
          <>
            <Button tone="neutral" onClick={() => setDismissed(true)}>OK</Button>
            <button type="button" className="gryt-link text-xs" onClick={move}>Found {who(name)}? Ask it instead</button>
          </>
        }
      >
        <span className="text-gryt-muted">
          Without {who(name)}, it takes 30 days. {peerName} will be asked to compare codes with you.
        </span>
      </Card>
    );
  }

  if (handover?.denied) {
    return (
      <Card title={`${upper(who(name))} said no`} actions={<Button onClick={move}>Ask again</Button>}>
        <span className="text-gryt-muted">Pressed it by mistake? Ask again.</span>
      </Card>
    );
  }

  if (handover && waiting) {
    return (
      <Card
        title={`Waiting for ${who(name)}`}
        actions={<button type="button" className="gryt-link text-xs" onClick={() => void giveUp()}>I don&rsquo;t have {that(name)} any more</button>}
      >
        <span className="text-gryt-muted">
          Open Gryt on {who(name)} and approve. Check it shows this code:
        </span>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <code className="rounded-[10px] bg-gryt-surface px-3.5 py-1.5 font-mono text-[22px] tracking-[0.2em] text-gryt-text select-all">{handover.code}</code>
          {seenAt && <span className="text-xs text-gryt-muted">Last used on {who(name)} {day(seenAt)}</span>}
        </div>
      </Card>
    );
  }

  return (
    <Card title={`Approve this device on ${serverName}`} actions={<Button onClick={move}>Approve this device</Button>}>
      <span className="text-gryt-muted">
        {upper(who(name))} has to approve it before DMs work here.
      </span>
    </Card>
  );
}
