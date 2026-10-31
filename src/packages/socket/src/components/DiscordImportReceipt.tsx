import { Button, Dialog, IconButton } from "@gryt/ui";

import { PiX } from "../../../../lib/icons";
import { type DiscordImportState, fmtCount } from "../utils/discordImport";
import { formatFileSize } from "../utils/formatFileSize";

type Finished = Extract<DiscordImportState, { kind: "done" | "missing" }>;

const MB = 1024 * 1024;

/** What a finished import brought over, and what to do about each file it couldn't. */
export function DiscordImportReceipt({
  open, onOpenChange, state, canRetry, canChangeLimit, onRetry, onDropPackage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: Finished;
  canRetry: boolean;
  canChangeLimit: boolean;
  onRetry: (urls: string[]) => void;
  onDropPackage: () => void;
}) {
  const big = state.leftOut.filter((f) => f.reason === "too_large");
  const gone = state.leftOut.filter((f) => f.reason === "not_downloaded");
  const need = Math.ceil(Math.max(0, ...big.map((f) => f.size ?? 0)) / MB);
  const again = (urls: string[]) => {
    onOpenChange(false);
    onRetry(urls);
  };
  const row = (f: Finished["leftOut"][number]) => (
    <li key={f.url} className="flex gap-3">
      <span className="min-w-0 flex-1 truncate">{f.name}</span>
      {f.size !== null && <span className="text-gryt-muted">{formatFileSize(f.size)}</span>}
    </li>
  );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup>
          <div className="discord-import" data-gryt="discord-import-receipt">
            <div className="flex items-center justify-between">
              <Dialog.Title className="discord-import-title">Discord import finished</Dialog.Title>
              <Dialog.Close>
                <IconButton size="xsmall" aria-label="Close"><PiX size={16} /></IconButton>
              </Dialog.Close>
            </div>
            <p className="discord-import-hint">
              {state.leftOut.length === 0
                ? "Everything came over."
                : `${fmtCount(state.leftOut.length)} ${state.leftOut.length === 1 ? "file" : "files"} didn\u2019t come over. All your messages did, and those messages say a file is missing.`}
            </p>
            {big.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="m-0 text-[13px] font-bold">Too big for this server</h3>
                <p className="discord-import-hint">
                  {canChangeLimit
                    ? `Raise this server\u2019s upload limit to at least ${fmtCount(need)} MB in Server settings, then try again.`
                    : `Ask whoever runs this server to raise the upload limit to at least ${fmtCount(need)} MB, then try again.`}
                </p>
                <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0 text-[13px]">{big.map(row)}</ul>
                <div>
                  {canRetry
                    ? <Button size="small" onClick={() => again(big.map((f) => f.url))}>Try again</Button>
                    : <Button size="small" onClick={onDropPackage}>Drop the package to try again</Button>}
                </div>
              </section>
            )}
            {gone.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="m-0 text-[13px] font-bold">Couldn&rsquo;t be downloaded</h3>
                <p className="discord-import-hint">Discord didn&rsquo;t hand these over. In a browser, PDFs, zips and similar need the Gryt desktop app. Otherwise, a newer package from Discord can have working links.</p>
                <ul className="m-0 flex max-h-40 list-none flex-col gap-1 overflow-y-auto p-0 text-[13px]">{gone.map(row)}</ul>
                <div>
                  {canRetry && <Button size="small" tone="neutral" onClick={() => again(gone.map((f) => f.url))}>Try again</Button>}
                </div>
              </section>
            )}
            <div className="flex justify-end">
              <Button size="small" tone="neutral" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
