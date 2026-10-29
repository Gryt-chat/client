import { Avatar, Button, Dialog, IconButton, TextField } from "@gryt/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { PiCheck, PiUploadSimple, PiX } from "../../../../lib/icons";
import { type DiscordDm, type DiscordImportPlan, fmtCount, fmtWhen, SAMPLE_DMS, samplePlan } from "../utils/discordImport";
import { formatFileSize } from "../utils/formatFileSize";

interface DiscordImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  peerName: string;
  peerAvatar?: string;
  onStart: (plan: DiscordImportPlan) => void;
}

const year = (at: number) => new Date(at).getUTCFullYear();

export function ImportSteps({ steps }: { steps: ReactNode[] }) {
  return (
    <ol className="discord-import-steps-list">
      {steps.map((step, i) => (
        <li key={i}><span className="discord-import-num" aria-hidden="true">{i + 1}</span><span>{step}</span></li>
      ))}
    </ol>
  );
}

/** Boards I2 to I4 (GRYT-1965): get the package, pick the chat, confirm. */
export function DiscordImportDialog({ open, onOpenChange, peerName, peerAvatar, onStart }: DiscordImportDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [dms, setDms] = useState<DiscordDm[]>([]);
  const [picked, setPicked] = useState<DiscordDm | null>(null);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setDms([]);
    setPicked(null);
    setQuery("");
  }, [open]);

  // shortcut: any file stands in for a package until the reader exists (GRYT-1965 piece 1).
  const read = (file: File | undefined) => {
    if (!file) return;
    const sorted = [...SAMPLE_DMS].sort((a, b) => b.messages - a.messages);
    setDms(sorted);
    setPicked(sorted[0] ?? null);
    setStep(2);
  };

  const shown = dms.filter((d) => d.name.toLowerCase().includes(query.trim().toLowerCase()));
  const plan = picked ? samplePlan(picked) : null;
  const tooBig = !!plan?.freeBytes && plan.dm.bytes > plan.freeBytes;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <div className="discord-import">
            <div className="flex items-center justify-between">
              <span className="discord-import-steps" aria-label={`Step ${step} of 3`}>
                {[1, 2, 3].map((n) => <span key={n} data-on={n <= step || undefined} data-current={n === step || undefined} />)}
              </span>
              <Dialog.Close>
                <IconButton size="xsmall" aria-label="Close"><PiX size={16} /></IconButton>
              </Dialog.Close>
            </div>

            {step === 1 && (
              <>
                <Dialog.Title className="discord-import-title">Bring your Discord chat with {peerName} over</Dialog.Title>
                <p className="discord-import-hint">Gryt doesn&rsquo;t log in to Discord. You ask Discord for a copy of your data, and this computer reads it.</p>
                <ImportSteps steps={[
                  <>In Discord, open <b>Settings → Data &amp; Privacy → Request all of my data</b>.</>,
                  <>Tick <b>Account</b>, <b>Messages</b> and <b>Servers</b>. Discord emails you a .zip, usually within a few days.</>,
                  <>Drop the .zip here <b>the day the email comes</b>. The file links in it stop working soon after.</>,
                ]} />
                <button
                  type="button"
                  className="discord-import-drop"
                  data-dragging={dragging || undefined}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); read(e.dataTransfer.files[0]); }}
                >
                  <PiUploadSimple size={24} />
                  <span><b>Drop package.zip</b> or <span className="gryt-link">choose a file</span></span>
                </button>
                <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={(e) => read(e.target.files?.[0])} />
                <div className="flex justify-end">
                  <Button tone="neutral" size="small" onClick={() => onOpenChange(false)}>Cancel</Button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <Dialog.Title className="discord-import-title">Which chat is this?</Dialog.Title>
                <p className="discord-import-hint">Your package has {fmtCount(dms.length)} DMs. The one you talk most in is first.</p>
                <TextField value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by Discord name" autoFocus />
                <div className="discord-import-dms" role="radiogroup" aria-label="Discord DMs">
                  {shown.map((d) => {
                    const on = picked?.channelId === d.channelId;
                    return (
                      <button key={d.channelId} type="button" role="radio" aria-checked={on} className="discord-import-dm" onClick={() => setPicked(d)}>
                        <span className="discord-import-letter" aria-hidden="true">{d.name[0]?.toUpperCase()}</span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-bold">{d.name}</span>
                          <span className="discord-import-hint">
                            {fmtCount(d.messages)} messages from you · {fmtCount(d.files)} files · {year(d.firstAt)} to {year(d.lastAt)}
                          </span>
                        </span>
                        {on && <PiCheck size={18} style={{ color: "var(--gryt-accent-9)" }} />}
                      </button>
                    );
                  })}
                </div>
                <div className="flex justify-end gap-2">
                  <Button tone="neutral" size="small" onClick={() => setStep(1)}>Back</Button>
                  <Button size="small" disabled={!picked} onClick={() => setStep(3)}>Next</Button>
                </div>
              </>
            )}

            {step === 3 && plan && (
              <>
                <Dialog.Title className="discord-import-title">Import into your chat with {peerName}</Dialog.Title>
                <dl className="discord-import-facts">
                  <dt>From</dt><dd>{plan.dm.name} on Discord</dd>
                  <dt>Your messages</dt><dd>{fmtCount(plan.dm.messages)}, from {new Date(plan.dm.firstAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</dd>
                  <dt>Files</dt><dd>{fmtCount(plan.dm.files)} · about {formatFileSize(plan.dm.bytes)}</dd>
                  {plan.linksUntil && (<><dt>Discord&rsquo;s file links work until</dt><dd>{fmtWhen(plan.linksUntil)}</dd></>)}
                  {plan.freeBytes !== null && (
                    <><dt>Space on this computer</dt><dd data-error={tooBig || undefined}>{formatFileSize(plan.dm.bytes)} needed · {formatFileSize(plan.freeBytes)} free</dd></>
                  )}
                </dl>
                <p className="discord-import-note">
                  <Avatar size="small" fallback={peerName[0]} src={peerAvatar} />
                  <span>Only your side is in your package. Gryt will ask {peerName} to add theirs from their own package. Until they do, you&rsquo;ll see your messages only.</span>
                </p>
                <p className="discord-import-hint">
                  Files download to this computer first, a few at a time, so they&rsquo;re safe before the links stop working. Then they go up to the server encrypted, as fast as your upload allows. You can pause and pick up later.
                </p>
                <div className="flex justify-end gap-2">
                  <Button tone="neutral" size="small" onClick={() => setStep(2)}>Back</Button>
                  <Button size="small" disabled={tooBig} onClick={() => { onStart(plan); onOpenChange(false); }}>Start import</Button>
                </div>
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
