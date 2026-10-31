import { Avatar, Button, IconButton } from "@gryt/ui";

import { isElectron } from "../../../../lib/electron";
import { PiArchiveFill, PiPauseFill, PiPlayFill, PiWarningFill } from "../../../../lib/icons";
import { type Count, type DiscordImportState, fmtCount, fmtTime, fmtWhen } from "../utils/discordImport";
import { formatFileSize } from "../utils/formatFileSize";
import { ImportSteps } from "./DiscordImportDialog";

interface DiscordImportCardProps {
  state: DiscordImportState;
  peerName: string;
  peerAvatar?: string;
  onPause: (paused: boolean) => void;
  onAddMine: () => void;
  onDismiss: () => void;
  onDetails: () => void;
}

function Bar({ label, count, active }: { label: string; count: Count; active: boolean }) {
  const pct = count.total ? Math.round((count.done / count.total) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="discord-import-hint flex">
        <span>{label}</span>
        <span className="ml-auto">{fmtCount(count.done)} of {fmtCount(count.total)}</span>
      </span>
      <div className="discord-import-bar" data-active={active && count.done < count.total ? "" : undefined} role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const monthYear = (at: number) => new Date(at).toLocaleDateString(undefined, { month: "short", year: "numeric" });

function whyMissing(linksUntil: number | null): string {
  if (linksUntil && linksUntil < Date.now()) return `The links stopped working ${fmtWhen(linksUntil)}.`;
  if (isElectron()) return "Discord didn\u2019t hand them over.";
  return "A browser can only download pictures, videos and text from Discord, so PDFs, zips and similar need the Gryt desktop app.";
}

/** The import in the DM sidebar: D5 while it runs, D6 for the other person, D8 once done, D9 for files left behind. */
export function DiscordImportCard({ state, peerName, peerAvatar, onPause, onAddMine, onDismiss, onDetails }: DiscordImportCardProps) {
  if (state.kind === "done") {
    return (
      <section className="flex flex-col gap-2" data-gryt="discord-import-card">
        <div className="flex items-baseline px-0.5">
          <h3 className="m-0 text-[13px] font-bold text-gryt-neutral-11">From Discord</h3>
          <span className="ml-auto text-xs text-gryt-muted">{state.theirs === null ? "your side" : "both sides"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-(--gryt-radius-md) bg-gryt-neutral-3 px-3 py-2.5 text-[13px]">
          <span>{fmtCount(state.mine)} from you{state.theirs !== null && `, ${fmtCount(state.theirs)} from ${peerName}`}</span>
          {state.tooLarge > 0 && <span>{fmtCount(state.tooLarge)} {state.tooLarge === 1 ? "file was" : "files were"} too big for this server, and their messages say so.</span>}
          <span className="text-gryt-muted">{fmtCount(state.files)} files · {monthYear(state.firstAt)} to {monthYear(state.lastAt)}</span>
          <button type="button" className="gryt-link cursor-pointer self-start border-0 bg-transparent p-0 text-[13px]" onClick={onDetails}>View details</button>
        </div>
      </section>
    );
  }

  if (state.kind === "stopped") {
    return (
      <div className="discord-import-card" data-gryt="discord-import-card">
        <div className="flex items-center gap-2">
          <PiArchiveFill size={16} style={{ color: "var(--gryt-accent-11)" }} />
          <span className="font-bold">Import stopped</span>
        </div>
        <p className="discord-import-text">
          {fmtCount(state.done)} of {fmtCount(state.total)} messages from {state.name} are in. Drop the same package again to carry on. Anything already here is skipped, and files that finished downloading aren&rsquo;t fetched twice.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="small" onClick={onAddMine}>Continue</Button>
          <Button size="small" tone="neutral" onClick={onDismiss}>Dismiss</Button>
        </div>
      </div>
    );
  }

  if (state.kind === "asked") {
    return (
      <div className="discord-import-card" data-gryt="discord-import-card">
        <div className="flex items-center gap-2.5">
          <Avatar size="small" fallback={state.by[0]} src={peerAvatar} />
          <span className="font-bold">{state.by} is bringing your Discord chat over</span>
        </div>
        <p className="discord-import-text">
          Their messages from Discord are coming in. Yours aren&rsquo;t in their package, so add them from your own Discord data.
        </p>
        <div className="flex flex-wrap gap-2">
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
        <div className="flex items-center gap-2">
          <PiWarningFill size={16} style={{ color: "var(--gryt-warning-11)" }} />
          <span className="font-bold">{fmtCount(left)} {left === 1 ? "file" : "files"} couldn&rsquo;t be downloaded</span>
        </div>
        <p className="discord-import-text">
          {whyMissing(state.linksUntil)} All messages are in, and {fmtCount(state.imported)} files are too.
        </p>
        <ImportSteps steps={[
          <>Request your data from Discord again, with <b>Messages</b> ticked.</>,
          <>Drop the new .zip in here the day the email comes.</>,
          <>Gryt fetches only the missing files.</>,
        ]} />
        <div className="flex flex-wrap gap-2">
          <Button size="small" onClick={onDetails}>View details</Button>
          <Button size="small" onClick={onAddMine}>Drop the new package</Button>
          <Button size="small" tone="neutral" onClick={onDismiss}>Dismiss</Button>
        </div>
      </div>
    );
  }

  const links = state.linksUntil ? `, links work until ${fmtWhen(state.linksUntil)}` : "";
  return (
    <div className="discord-import-card" data-gryt="discord-import-card">
      <div className="flex items-center gap-2">
        <PiArchiveFill size={16} style={{ color: "var(--gryt-accent-11)" }} />
        <span className="flex-1 font-bold">{state.paused ? "Import paused" : "Importing from Discord"}</span>
        <IconButton size="xsmall" tone="neutral" aria-label={state.paused ? "Resume" : "Pause"} onClick={() => onPause(!state.paused)}>
          {state.paused ? <PiPlayFill size={14} /> : <PiPauseFill size={14} />}
        </IconButton>
      </div>
      <Bar label="Messages" count={state.messages} active={!state.paused} />
      <Bar label="Downloaded" count={state.downloaded} active={!state.paused} />
      <Bar label="Sent to server" count={state.sent} active={!state.paused} />
      {!state.paused && (
        <p className="discord-import-hint">
          {formatFileSize(Math.round(state.bytesPerSecond))}/s.
          {state.finishesAt !== null && <> Finishes around {fmtTime(state.finishesAt)}{links}.</>}
        </p>
      )}
      {!state.paused && state.limited && (
        <p className="discord-import-hint">Waiting on this server&rsquo;s upload limit. It carries on by itself.</p>
      )}
      {!state.peerAdded && <p className="discord-import-hint">This is only your side. {peerName} can add theirs any time, and this doesn&rsquo;t wait for them.</p>}
    </div>
  );
}
