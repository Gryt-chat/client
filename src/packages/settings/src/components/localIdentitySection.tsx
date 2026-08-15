import { Alert, Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  PiCopySimple,
  PiEyeFill,
  PiUploadSimple,
  PiWarningFill,
} from "react-icons/pi";

import {
  getIdentityWords,
  importLocalIdentities,
  isLockedBackup,
  listLocalIdentityHosts,
  restoreIdentityFromWords,
  unlockBackup,
} from "@/common";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 */

/**
 * Saving and restoring an identity that has no account behind it.
 *
 * A local identity is a keypair on this device and nothing else. Clearing site
 * data takes it, and with it every server that identity was known on — the
 * roles, the ownership, the messages attributed to it. `replaceUserIdentity`
 * can hand a server user to a new identity, but somebody with a role has to run
 * it, which is no help at all when the person who lost the key is the owner.
 *
 * So this section exists to make the risk visible before it lands, and to give
 * people the one thing that actually fixes it: a copy of the key.
 *
 * Since GRYT-255 that copy is 24 words: the seed, which reproduces every
 * identity calculated from it and is short enough to keep in a password
 * manager. Older encrypted backup files remain importable, but new backups use
 * the words so there is one recovery format to understand.
 */

type Panel = "words" | "restore" | "unlock-file" | null;

export function LocalIdentitySection() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [words, setWords] = useState("");
  const [wordsInput, setWordsInput] = useState("");
  const [filePassword, setFilePassword] = useState("");
  const [lockedFile, setLockedFile] = useState("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    listLocalIdentityHosts()
      .then(setHosts)
      .catch(() => setHosts([]));
  }, []);

  useEffect(refresh, [refresh]);

  const closePanel = useCallback(() => {
    setPanel(null);
    setWords("");
    setWordsInput("");
    setFilePassword("");
    setLockedFile("");
    setCopied(false);
  }, []);

  const handleShowWords = useCallback(async () => {
    setBusy(true);
    try {
      setWords(await getIdentityWords());
      setPanel("words");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read your identity");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleRestoreWords = useCallback(async () => {
    setBusy(true);
    try {
      await restoreIdentityFromWords(wordsInput);
      toast.success("Identity restored. Reloading…", { duration: 4000 });
      // Reloaded for the same reason restoring a file is: anything that already
      // read a key still holds it, and would keep signing as whoever this device
      // was before — which looks like the restore silently not working.
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not restore");
    } finally {
      setBusy(false);
    }
  }, [wordsInput]);

  const applyBackup = useCallback(
    async (text: string) => {
      const restored = await importLocalIdentities(text);
      refresh();
      toast.success(
        `Restored ${restored.length} identit${restored.length === 1 ? "y" : "ies"}. Reloading…`,
        { duration: 4000 },
      );
      // Reloaded rather than carried on with. A restore replaces the keys the
      // running app has already read, and anything holding one keeps signing
      // as whoever it was before — which looks like the restore silently not
      // working. Verified: the identity comes back correctly on the far side
      // of a reload and not before it.
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
        toast.error(e instanceof Error ? e.message : "Could not restore");
      } finally {
        setBusy(false);
      }
    },
    [applyBackup],
  );

  const handleUnlockFile = useCallback(async () => {
    setBusy(true);
    try {
      await applyBackup(await unlockBackup(lockedFile, filePassword));
      closePanel();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not restore");
    } finally {
      setBusy(false);
    }
  }, [applyBackup, lockedFile, filePassword, closePanel]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-sm">Recovery key</span>
        <span className="text-xs text-gryt-muted">
          {hosts.length > 0
            ? `This device holds your identity for ${hosts.length} server${hosts.length === 1 ? "" : "s"}. Your recovery key restores that identity on another device.`
            : "Gryt creates a local identity when you join a server without an account. Your recovery key lets you restore it on another device."}
        </span>
      </div>

      {hosts.length > 0 && (
        <Alert severity="warning">
          <span className="inline-flex items-start gap-2">
            <PiWarningFill className="mt-0.5 shrink-0" size={15} />
            If you lose this device or clear its data, you will lose this
            identity. Store the recovery key in a password manager or another
            safe place.
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
          View recovery key
        </Button>

        <Button
          tone="neutral"
          size="small"
          disabled={busy}
          onClick={() => setPanel(panel === "restore" ? null : "restore")}
        >
          <PiUploadSimple size={16} />
          Restore identity
        </Button>
      </div>

      {panel === "words" && (
        <div className="flex flex-col gap-3 rounded-md border border-gryt-border p-4">
          <span className="text-xs text-gryt-muted">
            These 24 words can restore your identity. Anyone who has them can
            use it, so keep them like a password.
          </span>
          <code className="select-all break-words rounded-md bg-gryt-surface-raised p-3 font-mono text-sm leading-relaxed text-gryt-text">
            {words}
          </code>
          <div className="flex gap-2 flex-wrap">
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
              <span aria-live="polite">
                {copied ? "Copied" : "Copy recovery key"}
              </span>
            </Button>
            <Button tone="neutral" size="small" onClick={closePanel}>
              Hide
            </Button>
          </div>
        </div>
      )}

      {panel === "restore" && (
        <div className="flex flex-col gap-3 rounded-md border border-gryt-border p-4">
          <span className="text-xs text-gryt-muted">
            Paste your 24-word recovery key. Gryt will replace the local
            identity on this device and reload.
          </span>
          <label className="flex flex-col gap-1 text-xs" htmlFor="recovery-key">
            Recovery key
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
              Use recovery key
            </Button>
            <Button tone="neutral" size="small" onClick={closePanel}>
              Cancel
            </Button>
          </div>
          <div className="flex flex-col items-start gap-1 border-t border-gryt-border pt-3">
            <span className="text-xs text-gryt-muted">
              Have an older Gryt backup file?
            </span>
            <Button
              tone="ghost"
              size="small"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              Import backup file
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
            Enter the password for this older backup file.
          </span>
          <label
            className="flex flex-col gap-1 text-xs"
            htmlFor="backup-file-password"
          >
            Backup file password
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
              Import identity
            </Button>
            <Button tone="neutral" size="small" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
