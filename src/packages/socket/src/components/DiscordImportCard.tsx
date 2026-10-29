import { Button } from "@gryt/ui";

import { PiArchiveFill, PiPauseFill, PiPlayFill, PiWarningFill } from "../../../../lib/icons";
import { type Count, type DiscordImportState, fmtCount, fmtDuration, fmtWhen } from "../utils/discordImport";
import { formatFileSize } from "../utils/formatFileSize";

interface DiscordImportCardProps {
  state: DiscordImportState;
  peerName: string;
  onPause: (paused: boolean) => void;
  onAddMine: () => void;
  onDismiss: () => void;
}

function Bar({ label, count }: { label: string; count: Count }) {
  const pct = count.total ? Math.round((count.done / count.total) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="discord-import-hint">{label} · {fmtCount(count.done)} of {fmtCount(count.total)}</span>
      <div className="discord-import-bar" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The import's card at the top of the chat: I5 while it runs, I6 for the other person, I9 for files left behind. */
export function DiscordImportCard({ state, peerName, onPause, onAddMine, onDismiss }: DiscordImportCardProps) {
  if (state.kind === "asked") {
    return (
      <div className="discord-import-card" data-gryt="discord-import-card">
        <div className="flex items-center gap-2.5">
          <PiArchiveFill size={18} style={{ color: "var(--gryt-accent-11)" }} />
          <span className="flex-1 font-bold">{state.by} is bringing your Discord chat over</span>
        </div>
        <p className="discord-import-text">
          Their {fmtCount(state.messages)} messages are coming in. Yours aren&rsquo;t in their package, so add them from your own Discord data and the chat fills in on both sides.
        </p>
        <div className="flex gap-2">
          <Button size="small" onClick={onAddMine}>Add my side</Button>
          <Button size="small" tone="neutral" onClick={onDismiss}>Not now</Button>
        </div>
      </div>
    );
  }

  if (state.kind === "missing") {
    const left = state.files - state.imported;
    return (
      <div className="discord-import-card" data-tone="warning" data-gryt="discord-import-card">
        <div className="flex items-center gap-2.5">
          <PiWarningFill size={18} style={{ color: "var(--gryt-warning-11)" }} />
          <span className="flex-1 font-bold">{fmtCount(left)} files couldn&rsquo;t be downloaded</span>
        </div>
        <p className="discord-import-text">
          The links in this package stopped working on {fmtWhen(state.linksUntil)}. All your messages are in, and {fmtCount(state.imported)} files are too. To get the rest:
        </p>
        <ol className="discord-import-list">
          <li>Request your data from Discord again: <b>Settings → Data &amp; Privacy</b>, with <b>Messages</b> ticked.</li>
          <li>When the email comes, drop the new .zip in here the same day.</li>
          <li>Gryt fetches only the {fmtCount(left)} missing files.</li>
        </ol>
        <div className="flex gap-2">
          <Button size="small" onClick={onAddMine}>Drop the new package</Button>
          <Button size="small" tone="neutral" onClick={onDismiss}>Dismiss</Button>
        </div>
      </div>
    );
  }

  let linksLine = "";
  if (state.linksUntil) {
    const when = fmtWhen(state.linksUntil);
    linksLine = state.downloadsDoneAt < state.linksUntil ? `, well before the links stop working on ${when}` : `, but the links stop working on ${when}`;
  }
  return (
    <div className="discord-import-card" data-gryt="discord-import-card">
      <div className="flex items-center gap-2.5">
        <PiArchiveFill size={18} style={{ color: "var(--gryt-accent-11)" }} />
        <span className="flex-1 font-bold">{state.paused ? "Import paused" : "Importing from Discord"}</span>
        <Button size="small" tone="neutral" onClick={() => onPause(!state.paused)}>
          {state.paused ? <PiPlayFill size={14} /> : <PiPauseFill size={14} />} {state.paused ? "Resume" : "Pause"}
        </Button>
      </div>
      <div className="discord-import-bars">
        <Bar label="Messages" count={state.messages} />
        <Bar label="Downloaded" count={state.downloaded} />
        <Bar label="Sent to server" count={state.sent} />
      </div>
      {!state.paused && (
        <p className="discord-import-hint">
          Downloading 4 at a time, {formatFileSize(state.bytesPerSecond)}/s. Done by {fmtWhen(state.downloadsDoneAt)}{linksLine}. Sending to the server takes about {fmtDuration(state.sendingLeftMs)} more.
        </p>
      )}
      {!state.peerAdded && <p className="discord-import-hint">Waiting for {peerName} to add their side.</p>}
    </div>
  );
}
