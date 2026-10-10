import { Alert, Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import {
  getIdentityWords,
  importLocalIdentities,
  isLockedBackup,
  listGuestScopes,
  restoreIdentityFromWords,
  unlockBackup,
} from "@/common";
import { useTranslation } from "@/i18n";
import { clearRemovedEverywhere } from "@/socket";

import {
  PiEyeFill,
  PiUploadSimple,
  PiWarningFill,
} from "../../../../lib/icons";
import { RecoveryWordsPanel } from "./recoveryWords";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */

/**
 * Saving and restoring an identity that has no account behind it. The copy is 24
 * words since GRYT-255; older encrypted backup files remain importable.
 */

type Panel = "words" | "restore" | "unlock-file" | null;

export function LocalIdentitySection() {
  const { t: tr } = useTranslation();
  const [hasIdentity, setHasIdentity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [words, setWords] = useState("");
  const [wordsInput, setWordsInput] = useState("");
  const [filePassword, setFilePassword] = useState("");
  const [lockedFile, setLockedFile] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  /* Whether this device has been a guest anywhere, rather than how many keys are
     stored: since GRYT-285 the keys are derived on demand and not written down. */
  const refresh = useCallback(() => {
    setHasIdentity(listGuestScopes().length > 0);
  }, []);

  useEffect(refresh, [refresh]);

  const closePanel = useCallback(() => {
    setPanel(null);
    setWords("");
    setWordsInput("");
    setFilePassword("");
    setLockedFile("");
  }, []);

  const handleShowWords = useCallback(async () => {
    setBusy(true);
    try {
      setWords(await getIdentityWords());
      setPanel("words");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("ui.couldNotReadYourIdentity"));
    } finally {
      setBusy(false);
    }
  }, [tr]);

  const handleRestoreWords = useCallback(async () => {
    setBusy(true);
    try {
      await restoreIdentityFromWords(wordsInput);
      // Knowing the words is what lets a device removed from MLS set up again (GRYT-1555).
      clearRemovedEverywhere();
      toast.success(tr("ui.identityRestoredReloading"), { duration: 4000 });
      // Reloaded for the same reason restoring a file is: anything that already
      // read a key still holds it, and keeps signing as whoever this device was.
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("ui.couldNotRestore"));
    } finally {
      setBusy(false);
    }
  }, [wordsInput, tr]);

  const applyBackup = useCallback(
    async (text: string) => {
      const restored = await importLocalIdentities(text);
      clearRemovedEverywhere();
      refresh();
      toast.success(
        `Restored ${restored.length} identit${restored.length === 1 ? "y" : "ies"}. Reloading…`,
        { duration: 4000 },
      );
      // Reloaded rather than carried on with: anything holding a key keeps
      // signing as whoever it was, which looks like the restore not working.
      setTimeout(() => window.location.reload(), 1500);
    },
    [refresh],
  );

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const text = await file.text();
        if (isLockedBackup(text)) {
          // Held until the password arrives. Reading it again after would mean
          // keeping the File around, and the picker has already been cleared.
          setLockedFile(text);
          setPanel("unlock-file");
          return;
        }
        await applyBackup(text);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : tr("ui.couldNotRestore"));
      } finally {
        setBusy(false);
      }
    },
    [applyBackup, tr],
  );

  const handleUnlockFile = useCallback(async () => {
    setBusy(true);
    try {
      await applyBackup(await unlockBackup(lockedFile, filePassword));
      closePanel();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("ui.couldNotRestore"));
    } finally {
      setBusy(false);
    }
  }, [applyBackup, lockedFile, filePassword, closePanel, tr]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-sm">{tr("ui.recoveryKey")}</span>
        <span className="text-xs text-gryt-muted">
          {tr("ui.yourRecoveryKeyIsTheIdentityYouUse")}
        </span>
      </div>

      {hasIdentity && (
        <Alert severity="warning">
          <span className="inline-flex items-start gap-2">
            <PiWarningFill className="mt-0.5 shrink-0" size={15} />
            {tr("ui.ifYouLoseThisDeviceOrClearIts")}
          </span>
        </Alert>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button
          size="small"
          disabled={busy}
          onClick={() => void handleShowWords()}
        >
          <PiEyeFill size={16} />
          {tr("ui.viewRecoveryKey")}
        </Button>

        <Button
          tone="neutral"
          size="small"
          disabled={busy}
          onClick={() => setPanel(panel === "restore" ? null : "restore")}
        >
          <PiUploadSimple size={16} />
          {tr("ui.restoreIdentity")}
        </Button>
      </div>

      {panel === "words" && (
        <RecoveryWordsPanel
          words={words}
          copyLabel="Copy recovery key"
          onHide={closePanel}
          note={
            <>
              {tr("ui.these24WordsCanRestoreYourIdentityAnyone")}
            </>
          }
        />
      )}

      {panel === "restore" && (
        <div className="flex flex-col gap-3 rounded-md border border-gryt-border p-4">
          <span className="text-xs text-gryt-muted">
            {tr("ui.pasteYour24WordRecoveryKeyGrytWill")}
          </span>
          <label className="flex flex-col gap-1 text-xs" htmlFor="recovery-key">
            {tr("ui.recoveryKey")}
            <TextField
              id="recovery-key"
              type="password"
              autoComplete="current-password"
              placeholder="word word word …"
              value={wordsInput}
              disabled={busy}
              onChange={(e) => setWordsInput(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              size="small"
              disabled={busy || !wordsInput.trim()}
              onClick={() => void handleRestoreWords()}
            >
              {tr("ui.useRecoveryKey")}
            </Button>
            <Button tone="neutral" size="small" onClick={closePanel}>
              {tr("ui.cancel")}
            </Button>
          </div>
          <div className="flex flex-col items-start gap-1 border-t border-gryt-border pt-3">
            <span className="text-xs text-gryt-muted">
              {tr("ui.haveAnOlderGrytBackupFile")}
            </span>
            <Button
              tone="ghost"
              size="small"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {tr("ui.importBackupFile")}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleFile(file);
              }}
            />
          </div>
        </div>
      )}

      {panel === "unlock-file" && (
        <div className="flex flex-col gap-2 rounded-md border border-gryt-border p-3">
          <span className="text-xs text-gryt-muted">
            {tr("ui.enterThePasswordForThisOlderBackupFile")}
          </span>
          <label
            className="flex flex-col gap-1 text-xs"
            htmlFor="backup-file-password"
          >
            {tr("ui.backupFilePassword")}
            <TextField
              id="backup-file-password"
              type="password"
              autoComplete="current-password"
              value={filePassword}
              disabled={busy}
              onChange={(e) => setFilePassword(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              tone="neutral"
              size="small"
              disabled={busy || !filePassword}
              onClick={() => void handleUnlockFile()}
            >
              {tr("ui.importIdentity")}
            </Button>
            <Button tone="neutral" size="small" onClick={closePanel}>
              {tr("ui.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
