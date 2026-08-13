import { Alert, Button, TextField } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  PiCopySimple,
  PiDownloadSimple,
  PiEyeFill,
  PiKeyholeFill,
  PiUploadSimple,
  PiWarningFill,
} from "react-icons/pi";

import {
  authoriseDeviceFromBackup,
  exportLocalIdentities,
  getIdentityWords,
  importLocalIdentities,
  isLockedBackup,
  listDelegations,
  listLocalIdentityHosts,
  lockBackup,
  restoreIdentityFromWords,
  unlockBackup,
} from "@/common";

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
 * Since GRYT-255 there are two copies to choose from, and they are not the same
 * thing. The **words** are the seed, which reproduces every identity calculated
 * from it — short enough to live in a password manager, which is where it wants
 * to be. The **file** is the words plus any identity the seed cannot reproduce,
 * which is the ones generated before the seed existed. Most people only need the
 * words; anyone who joined servers before this shipped needs the file too, and
 * is told so rather than left to find out.
 *
 * The words are shown as "identity backup" and never as a "recovery phrase" or
 * "seed phrase". Those belong to crypto wallets, and a screen that looks like
 * one teaches people a habit worth exactly one drained wallet.
 */

type Panel = "words" | "restore-words" | "save-file" | "unlock-file" | null;

export function LocalIdentitySection() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [delegated, setDelegated] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [words, setWords] = useState("");
  const [wordsInput, setWordsInput] = useState("");
  const [filePassword, setFilePassword] = useState("");
  const [lockedFile, setLockedFile] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Which button opened the picker. One input, two meanings.
  const mode = useRef<"restore" | "authorise">("restore");

  const refresh = useCallback(() => {
    listLocalIdentityHosts()
      .then(setHosts)
      .catch(() => setHosts([]));
    setDelegated(listDelegations().map((d) => d.host));
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

  const handleSaveFile = useCallback(async () => {
    setBusy(true);
    try {
      const { backup, unexportable } = await exportLocalIdentities();

      if (!backup.seed && backup.identities.length === 0) {
        toast.error(
          unexportable.length > 0
            ? "These identities were made before backups existed and cannot be saved."
            : "There is no local identity on this device yet.",
        );
        return;
      }

      const locked = await lockBackup(
        JSON.stringify(backup, null, 2),
        filePassword,
      );
      const blob = new Blob([locked], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gryt-identity.json";
      a.click();
      URL.revokeObjectURL(url);
      closePanel();

      if (unexportable.length > 0) {
        // Named rather than skipped. A backup that quietly leaves servers out
        // is worse than none, because it is trusted.
        toast.error(
          `Saved, but ${unexportable.length} older identity could not be included: ${unexportable.join(", ")}`,
          { duration: 8000 },
        );
      } else {
        toast.success("Identity file saved");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save identity");
    } finally {
      setBusy(false);
    }
  }, [filePassword, closePanel]);

  const applyBackup = useCallback(
    async (text: string) => {
      if (mode.current === "authorise") {
        const authorised = await authoriseDeviceFromBackup(text);
        refresh();
        toast.success(
          `This device can now act as that identity on ${authorised.length} server${authorised.length === 1 ? "" : "s"}. Your key was not saved here.`,
          { duration: 8000 },
        );
        return;
      }

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
        <span className="font-medium text-sm">
          Identity without an account
        </span>
        <span className="text-xs text-gryt-muted">
          {hosts.length > 0
            ? `You have an identity on ${hosts.length} server${hosts.length === 1 ? "" : "s"} that isn't tied to a Gryt account. One key per server, all of them worked out from a single backup held on this device.`
            : "Servers you join without a Gryt account give you an identity held only on this device."}
        </span>
      </div>

      {hosts.length > 0 && (
        <Alert severity="warning"><span className="inline-flex items-start gap-2"><PiWarningFill size={15} />Clearing your browser data deletes these, and there is no way to get
            them back — including any server you own. Save a copy somewhere safe.</span></Alert>
      )}

      <div className="flex gap-2 flex-wrap">
        <Button tone="neutral" size="small"
          disabled={busy}
          onClick={() => void handleShowWords()}
        >
          <PiEyeFill size={16} />
          Show my identity backup
        </Button>

        <Button tone="neutral" size="small"
          disabled={busy}
          onClick={() => setPanel(panel === "restore-words" ? null : "restore-words")}
        >
          <PiUploadSimple size={16} />
          I already have one
        </Button>

        <Button tone="neutral" size="small"
          disabled={busy}
          onClick={() => setPanel(panel === "save-file" ? null : "save-file")}
        >
          <PiDownloadSimple size={16} />
          Save a backup file
        </Button>

        <Button tone="neutral" size="small"
          disabled={busy}
          onClick={() => {
            mode.current = "restore";
            fileRef.current?.click();
          }}
        >
          <PiUploadSimple size={16} />
          Restore from a file
        </Button>

        <Button tone="neutral" size="small"
          disabled={busy}
          onClick={() => {
            mode.current = "authorise";
            fileRef.current?.click();
          }}
        >
          <PiKeyholeFill size={16} />
          Authorise this device
        </Button>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so choosing the same file twice still fires a change.
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
      </div>

      {panel === "words" && (
        <div className="flex flex-col gap-2 rounded-md border border-gryt-border p-3">
          <span className="text-xs text-gryt-muted">
            These 24 words are your identity on every server you join without an
            account. Save them in your password manager.
          </span>
          <code className="text-xs leading-relaxed select-all break-words font-mono">
            {words}
          </code>
          <div className="flex gap-2 flex-wrap">
            <Button tone="neutral" size="small"
              onClick={() => {
                navigator.clipboard
                  .writeText(words)
                  .then(() => toast.success("Copied"))
                  .catch(() => toast.error("Could not copy"));
              }}
            >
              <PiCopySimple size={16} />
              Copy
            </Button>
            <Button tone="neutral" size="small" onClick={closePanel}>
              Hide
            </Button>
          </div>
          <span className="text-xs text-gryt-muted">
            Anyone who has these words is you. They do not cover identities from
            before this feature existed — for those, save a backup file as well.
          </span>
        </div>
      )}

      {panel === "restore-words" && (
        <div className="flex flex-col gap-2 rounded-md border border-gryt-border p-3">
          <span className="text-xs text-gryt-muted">
            Paste the 24 words from your other device. This device becomes that
            identity everywhere it is used.
          </span>
          {/* A real password field, so a password manager offers to fill it. */}
          <TextField
            type="password"
            autoComplete="current-password"
            placeholder="word word word …"
            value={wordsInput}
            disabled={busy}
            onChange={(e) => setWordsInput(e.target.value)}
          />
          <div className="flex gap-2">
            <Button tone="neutral" size="small"
              disabled={busy || !wordsInput.trim()}
              onClick={() => void handleRestoreWords()}
            >
              Use this identity
            </Button>
            <Button tone="neutral" size="small" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === "save-file" && (
        <div className="flex flex-col gap-2 rounded-md border border-gryt-border p-3">
          <span className="text-xs text-gryt-muted">
            Choose a password for the file. Without one it would sit in your
            downloads readable by anything that can read the folder.
          </span>
          <TextField
            type="password"
            autoComplete="new-password"
            placeholder="Password for the file"
            value={filePassword}
            disabled={busy}
            onChange={(e) => setFilePassword(e.target.value)}
          />
          <div className="flex gap-2">
            <Button tone="neutral" size="small"
              disabled={busy || !filePassword}
              onClick={() => void handleSaveFile()}
            >
              Save file
            </Button>
            <Button tone="neutral" size="small" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === "unlock-file" && (
        <div className="flex flex-col gap-2 rounded-md border border-gryt-border p-3">
          <span className="text-xs text-gryt-muted">
            That file is password protected.
          </span>
          <TextField
            type="password"
            autoComplete="current-password"
            placeholder="Password for the file"
            value={filePassword}
            disabled={busy}
            onChange={(e) => setFilePassword(e.target.value)}
          />
          <div className="flex gap-2">
            <Button tone="neutral" size="small"
              disabled={busy || !filePassword}
              onClick={() => void handleUnlockFile()}
            >
              Open it
            </Button>
            <Button tone="neutral" size="small" onClick={closePanel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {delegated.length > 0 && (
        <span className="text-xs text-gryt-muted">
          This device is authorised to act as a saved identity on{" "}
          {delegated.length} server{delegated.length === 1 ? "" : "s"}. The
          authorisation runs out after 30 days, and renewing it means picking
          the file again.
        </span>
      )}

      <span className="text-xs text-gryt-muted">
        The words and the file are both the identity — anyone who has either can
        be you on those servers, so keep them as you would a password.
      </span>

      <span className="text-xs text-gryt-muted">
        <strong>Restore</strong> makes this device that identity, by copying the
        key into it. <strong>Authorise</strong> leaves the key in the file and
        lets it vouch for this device instead, so the key is never stored here
        and the permission expires on its own. Prefer authorising on a machine
        you do not fully control.
      </span>
    </div>
  );
}
