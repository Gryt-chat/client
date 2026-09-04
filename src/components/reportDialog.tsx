import {
  buildReport,
  describeAttached,
  MESSAGE_MAX,
  type Report,
  type ReportType,
} from "@gryt/core";
import { Alert, Button, Checkbox, Dialog, Divider, TextField } from "@gryt/ui";
import { useMemo, useState } from "react";
import { PiBugFill, PiChatCircleDotsFill, PiPaperPlaneRightFill } from "react-icons/pi";

import { useDiagnostics } from "../lib/reports/diagnostics";
import { recentLogs } from "../lib/reports/logs";
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

  /**
   * The log tail, captured the moment it is asked for rather than at send.
   *
   * Otherwise a line arriving between reading the payload and pressing send
   * would mean the thing reviewed is not the thing posted, which is the one
   * property this whole panel exists to provide.
   */
  const [logs, setLogs] = useState<string[] | null>(null);

  /**
   * One report object, previewed and posted.
   *
   * Building it twice would let the two disagree — `sessionUptimeSec` alone
   * moves between renders — and somebody who read the payload would have sent
   * a different one.
   */
  const report = useMemo(
    () => buildReport(type, { message }, { ...diagnostics, logs: logs ?? undefined }),
    [type, message, diagnostics, logs],
  );

  const attached = useMemo(() => describeAttached(report), [report]);

  const copy = COPY[type];
  const empty = message.trim() === "";

  async function send() {
    setSending(true);
    setError(null);
    try {
      await submitReport(report);
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

        <Attached
          lines={attached}
          report={report}
          includeLogs={logs !== null}
          onIncludeLogs={(on) => setLogs(on ? recentLogs() : null)}
        />

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
 * Everything that goes with what they wrote, and the payload itself, so
 * somebody describing a crash can see their build number and route are going
 * too.
 *
 * **The list is a summary; the JSON is the thing.** The exact object that will
 * be posted is one click away, and it is the same object rather than a second
 * one built for display.
 *
 * **The log tail is off unless asked for** — it is the one field that describes
 * the person rather than the build.
 */
function Attached({
  lines,
  report,
  includeLogs,
  onIncludeLogs,
}: {
  lines: { label: string; value: string }[];
  report: Report;
  includeLogs: boolean;
  onIncludeLogs: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {lines.length > 0 && (
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
      )}

      <details className="rounded-(--gryt-radius-lg) border border-gryt-neutral-6 px-3 py-2">
        <summary className="cursor-pointer text-sm text-gryt-muted">
          Read the exact data
        </summary>
        <pre
          className="mt-2 max-h-64 overflow-auto text-xs leading-relaxed"
          style={{ fontFamily: "var(--code-font-family)" }}
        >
          {JSON.stringify(report, null, 2)}
        </pre>
      </details>

      <label className="flex cursor-pointer items-start gap-2 text-xs text-gryt-muted">
        <Checkbox checked={includeLogs} onCheckedChange={onIncludeLogs} />
        <span>
          Include the app&rsquo;s recent log. It makes a bug far easier to find, and it
          can contain personal information — a failed connection records the address of
          the server, which for a self-hosted one is often a home address.
        </span>
      </label>

      {/* Accurate rather than reassuring, and it has to change with the box. A
          server's version is a number about software; its address is not. */}
      <span className="text-xs text-gryt-muted">
        {includeLogs
          ? "No messages and no names. The log may name servers you connect to."
          : "No messages, no names, and nothing about who you talk to."}
      </span>
    </div>
  );
}

/**
 * It waits. Closing itself after 2.5 seconds flashes a paragraph at somebody
 * and takes it away while they are reading it.
 *
 * **The title is the words mobile's toast already uses.** Two clients saying
 * "received" and "sent" for one event reads as two different things happening.
 *
 * Nothing here claims what happens next — that is a promise this dialog is in
 * no position to make.
 */
function Sent({ type, onDone }: { type: ReportType; onDone: () => void }) {
  const bug = type === "bug";

  return (
    <>
      <Dialog.Title>{bug ? "Bug report received" : "Feedback received"}</Dialog.Title>
      <Dialog.Description>
        {bug
          ? "Thanks for your bug report, we greatly appreciate it."
          : "Thanks for your feedback, we greatly appreciate it."}
      </Dialog.Description>

      {/* Focused on mount so Enter closes it without reaching for the mouse,
          which is the whole reason somebody is still looking at this. Esc and
          the backdrop already close it through Dialog.Root. */}
      <div className="mt-6 flex justify-end">
        <Button size="small" autoFocus onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  );
}
