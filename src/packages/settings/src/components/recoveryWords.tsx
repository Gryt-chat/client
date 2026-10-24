import { Alert, Button } from "@gryt/ui";
import { type ReactNode, useCallback, useState } from "react";
import toast from "react-hot-toast";

import { getIdentityWords } from "@/common";

import { QrCode } from "../../../../components/linkDevice";
import { PiCopySimple, PiEyeFill, PiWarningFill } from "../../../../lib/icons";
import { saveBlob } from "../../../socket/src/utils/downloadFile";
import {
  HIDDEN,
  nextWordsView,
  RECOVERY_KEY_FILE_NAME,
  recoveryKeyFileText,
  type WordsAction,
  type WordsView,
} from "./recoveryWordsStep";

/** The 24 words on screen, to copy, save as a file or scan. The guest section and the account one share it. */
export function RecoveryWordsPanel({
  words,
  note,
  copyLabel,
  onHide,
}: {
  words: string;
  note: ReactNode;
  copyLabel: string;
  onHide(): void;
}) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-gryt-border p-4">
      <span className="text-xs text-gryt-muted">{note}</span>
      <code className="select-all break-words rounded-md bg-gryt-surface-raised p-3 font-mono text-sm leading-relaxed text-gryt-text">
        {words}
      </code>
      {qr && (
        <div className="flex flex-col items-center gap-2">
          <QrCode text={words} label="Your 24 words as a code to scan" />
          <span className="text-xs text-gryt-muted">Scan this from the Gryt app on your new device.</span>
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <Button tone="neutral" size="small" onClick={() => saveBlob(new Blob([recoveryKeyFileText(words)], { type: "text/plain" }), RECOVERY_KEY_FILE_NAME)}>
          Save as file
        </Button>
        <Button tone="neutral" size="small" aria-pressed={qr} onClick={() => setQr((v) => !v)}>
          {qr ? "Hide code" : "Show as code"}
        </Button>
        <Button
          tone="neutral"
          size="small"
          onClick={() => {
            navigator.clipboard
              .writeText(words)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2500);
              })
              .catch(() => toast.error("Could not copy"));
          }}
        >
          <PiCopySimple size={16} />
          <span aria-live="polite">{copied ? "Copied" : copyLabel}</span>
        </Button>
        <Button tone="neutral" size="small" onClick={onHide}>
          Hide
        </Button>
      </div>
    </div>
  );
}

/**
 * "Show my 24 words" for a signed-in account, behind a confirmation. Renders nothing
 * unless this device holds the message key: the words are that key.
 */
export function AccountWordsReveal({
  keyIsHere,
  startAt = "hidden",
  label = "Show my 24 words",
}: {
  keyIsHere: boolean;
  startAt?: "hidden" | "confirming";
  label?: string;
}) {
  const [view, setView] = useState<WordsView>(startAt === "confirming" ? { step: "confirming" } : HIDDEN);
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (action: WordsAction) => {
      setBusy(true);
      try {
        setView(await nextWordsView(view, action, { keyIsHere, readWords: getIdentityWords }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn’t read your 24 words.");
      } finally {
        setBusy(false);
      }
    },
    [view, keyIsHere],
  );

  if (!keyIsHere) return null;

  if (view.step === "shown") {
    return (
      <RecoveryWordsPanel
        words={view.words}
        copyLabel="Copy words"
        onHide={() => void act("hide")}
        note={
          <>
            Save these in a password manager, or as a file. If you lose every
            device, they&rsquo;re the only way to get your messages back.
          </>
        }
      />
    );
  }

  if (view.step === "confirming") {
    return (
      <div className="flex flex-col gap-3">
        <Alert severity="warning">
          <span className="inline-flex items-start gap-2">
            <PiWarningFill className="mt-0.5 shrink-0" size={15} />
            Anyone with these words can read your direct messages and become you.
            Make sure nobody can see your screen.
          </span>
        </Alert>
        <div className="flex gap-2">
          <Button size="small" disabled={busy} onClick={() => void act("confirm")}>
            Show them
          </Button>
          <Button tone="neutral" size="small" disabled={busy} onClick={() => void act("hide")}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Button tone="neutral" size="small" disabled={busy} onClick={() => void act("show")}>
        <PiEyeFill size={16} />
        {label}
      </Button>
    </div>
  );
}
