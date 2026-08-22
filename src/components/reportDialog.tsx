import { Alert, Button, Dialog, Divider, TextField } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import { PiBugFill, PiChatCircleDotsFill, PiPaperPlaneRightFill } from "react-icons/pi";

import { useDiagnostics } from "../lib/reports/diagnostics";
import {
  buildReport,
  describeAttached,
  MESSAGE_MAX,
  type ReportType,
} from "../lib/reports/report";
import { submitReport } from "../lib/reports/submit";
import { useReportForm } from "../lib/reports/useReportForm";

/**
 * Telling us something is broken, without leaving the app.
 *
 * This replaces two links that opened a browser: a Fider board for feedback and
 * a prefilled GitHub issue for bugs. Both asked somebody to sign in to a third
 * party before they could say anything, which is a wall in front of exactly the
 * people worth hearing from — and neither could carry the Electron version, the
 * bundled server's version, or the tail of the renderer log, which are the
 * fields that make a voice bug diagnosable.
 *
 * The mobile app has the same form, posting to the same service.
 */
export function ReportDialog() {
  const { openAs, close } = useReportForm();

  return (
    <Dialog.Root
      open={openAs !== null}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="max-w-[560px]">
          {/* Keyed on the type so switching rows starts a clean form rather
              than reusing the last one's state, and unmounting on close throws
              away a sent report's "thanks" screen. */}
          {openAs && <ReportForm key={openAs} type={openAs} onDone={close} />}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The same words the mobile form uses, deliberately.
 *
 * Two clients asking for the same thing in different language reads as two
 * features. Mobile's wording is the considered one (GRYT-530) — the bug
 * prompt asks what you were doing, and the feedback prompt names the three
 * things people actually write in.
 */
const COPY: Record<ReportType, { title: string; description: string; placeholder: string; send: string }> = {
  bug: {
    title: "Report a bug",
    description: "What happened, and what you were doing when it did.",
    placeholder: "The call dropped when I switched network…",
    send: "Send report",
  },
  feedback: {
    title: "Give feedback",
    description: "Something missing, something in the way, something you liked.",
    placeholder: "I wish I could…",
    send: "Send feedback",
  },
};

function ReportForm({ type, onDone }: { type: ReportType; onDone: () => void }) {
  const diagnostics = useDiagnostics();

  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /* Built from the same function that builds what is posted, so the list of
     what is attached cannot drift from what actually goes. */
  const attached = useMemo(
    () => describeAttached(buildReport(type, { message }, diagnostics)),
    [type, message, diagnostics],
  );

  const copy = COPY[type];
  const empty = message.trim() === "";

  async function send() {
    setSending(true);
    setError(null);
    try {
      await submitReport(buildReport(type, { message }, diagnostics));
      setSent(true);
    } catch (e) {
      /* Deliberately keeps the message in the box. Somebody who typed three
         paragraphs about a crash and lost them to a failed send does not type
         them again. */
      setError(e instanceof Error ? e.message : "That did not send.");
    } finally {
      setSending(false);
    }
  }

  if (sent) return <Sent type={type} onDone={onDone} />;

  return (
    <>
      <Dialog.Title>
        <span className="flex items-center gap-2">
          {type === "bug" ? <PiBugFill size={18} /> : <PiChatCircleDotsFill size={18} />}
          {copy.title}
        </span>
      </Dialog.Title>
      <Dialog.Description>{copy.description}</Dialog.Description>

      <div className="mt-4 flex flex-col gap-3">
        <TextField
          aria-label={copy.title}
          multiline
          minRows={5}
          autoFocus
          maxLength={MESSAGE_MAX}
          placeholder={copy.placeholder}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            setError(null);
          }}
        />

        <Attached lines={attached} />

        {error && <Alert severity="error">{error}</Alert>}

        <Divider />

        <div className="flex justify-end gap-3">
          <Dialog.Close render={<Button tone="neutral" size="small">Cancel</Button>} />
          <Button size="small" disabled={empty || sending} onClick={() => void send()}>
            <PiPaperPlaneRightFill size={14} />
            {sending ? "Sending…" : copy.send}
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * What rides along, said out loud.
 *
 * Not a disclosure notice and not a consent gate. Somebody about to describe a
 * crash should be able to see, without leaving the dialog, that their build
 * number and the route they were on are going too.
 *
 * **Closed, with the sentence outside it.** Expanded, ten rows of diagnostics
 * sit between the message and the send button, which is a wall of numbers in
 * front of the one thing the form is for. Shut, the list is a line to open and
 * the claim that matters is still read without opening anything.
 */
function Attached({ lines }: { lines: { label: string; value: string }[] }) {
  if (lines.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <details className="rounded-(--gryt-radius-lg) border border-gryt-neutral-6 px-3 py-2">
        <summary className="cursor-pointer text-sm text-gryt-muted">
          What gets sent with this
        </summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {lines.map((line) => (
            <div key={line.label} className="contents">
              <dt className="text-gryt-muted">{line.label}</dt>
              <dd style={{ fontFamily: "var(--code-font-family)" }}>{line.value}</dd>
            </div>
          ))}
        </dl>
      </details>
      {/* Accurate rather than reassuring. A server's *version* does go, when
          there is one — that is a number about the software, not about the
          people on it, and claiming "nothing from your servers" while sending
          it would be the kind of privacy line that is worth less than none. */}
      <span className="text-xs text-gryt-muted">
        No messages, no names, and nothing about who you talk to.
      </span>
    </div>
  );
}

function Sent({ type, onDone }: { type: ReportType; onDone: () => void }) {
  /* Closes itself. Somebody who has said their piece is done with this dialog,
     and leaving it open makes them dismiss a confirmation they did not ask
     for — but not instantly, or the form looks like it failed to open. */
  useEffect(() => {
    const timer = setTimeout(onDone, 2500);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <>
      <Dialog.Title>Sent</Dialog.Title>
      <Dialog.Description>
        {type === "bug"
          ? "Thanks — that is in the inbox with everything the app knows about this run."
          : "Thanks. That is read by a person, not a vote counter."}
      </Dialog.Description>
    </>
  );
}
