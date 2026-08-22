import { Alert, Button, Dialog, Divider, TextField } from "@gryt/ui";
import { useEffect, useMemo, useState } from "react";
import { PiBugFill, PiChatCircleDotsFill, PiPaperPlaneRightFill } from "react-icons/pi";

import { useDiagnostics } from "../lib/reports/diagnostics";
import {
  buildReport,
  CONTACT_MAX,
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

const COPY: Record<ReportType, { title: string; description: string; placeholder: string }> = {
  bug: {
    title: "Report a bug",
    description:
      "What happened, and what you were doing when it did. This goes straight to Sivert.",
    placeholder:
      "Voice cut out about a minute after joining, and the other person could still hear me…",
  },
  feedback: {
    title: "Give feedback",
    description:
      "Anything you want to say about Gryt. This goes straight to Sivert.",
    placeholder: "The server list would be easier to read if…",
  },
};

function ReportForm({ type, onDone }: { type: ReportType; onDone: () => void }) {
  const diagnostics = useDiagnostics();

  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /* Built from the same function that builds what is posted, so the list of
     what is attached cannot drift from what actually goes. */
  const attached = useMemo(
    () => describeAttached(buildReport(type, { message, contact }, diagnostics)),
    [type, message, contact, diagnostics],
  );

  const copy = COPY[type];
  const empty = message.trim() === "";

  async function send() {
    setSending(true);
    setError(null);
    try {
      await submitReport(buildReport(type, { message, contact }, diagnostics));
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

        {/* Optional and asked for rather than taken. The account has an email
            on it, and reading that without asking would make every report a
            signed one whether or not somebody wanted a reply. */}
        <TextField
          aria-label="How to reach you"
          maxLength={CONTACT_MAX}
          placeholder="Email or username, if you want a reply — optional"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
        />

        <Attached lines={attached} />

        {error && <Alert severity="error">{error}</Alert>}

        <Divider />

        <div className="flex justify-end gap-3">
          <Dialog.Close render={<Button tone="neutral" size="small">Cancel</Button>} />
          <Button size="small" disabled={empty || sending} onClick={() => void send()}>
            <PiPaperPlaneRightFill size={14} />
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * What rides along, said out loud.
 *
 * A form that quietly ships a route, a server version and a log tail is worse
 * than one that says so, and this is what makes "what is attached" answerable
 * without reading the source.
 */
function Attached({ lines }: { lines: { label: string; value: string }[] }) {
  if (lines.length === 0) return null;

  return (
    <details className="rounded-(--gryt-radius-lg) border border-gryt-neutral-6 px-3 py-2">
      <summary className="cursor-pointer text-sm text-gryt-muted">
        Sent with this report ({lines.length})
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
