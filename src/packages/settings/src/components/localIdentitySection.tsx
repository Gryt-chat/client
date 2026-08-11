import { Button, Callout, Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { PiDownloadSimple, PiUploadSimple, PiWarningFill } from "react-icons/pi";

import {
  exportLocalIdentities,
  importLocalIdentities,
  listLocalIdentityHosts,
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
 */
export function LocalIdentitySection() {
  const [hosts, setHosts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(() => {
    listLocalIdentityHosts()
      .then(setHosts)
      .catch(() => setHosts([]));
  }, []);

  useEffect(refresh, [refresh]);

  const handleSave = useCallback(async () => {
    setBusy(true);
    try {
      const { backup, unexportable } = await exportLocalIdentities();

      if (backup.identities.length === 0) {
        toast.error(
          unexportable.length > 0
            ? "These identities were made before backups existed and cannot be saved."
            : "There is no local identity on this device yet.",
        );
        return;
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gryt-identity.json";
      a.click();
      URL.revokeObjectURL(url);

      if (unexportable.length > 0) {
        // Named rather than skipped. A backup that quietly leaves servers out
        // is worse than none, because it is trusted.
        toast.error(
          `Saved, but ${unexportable.length} older identity could not be included: ${unexportable.join(", ")}`,
          { duration: 8000 },
        );
      } else {
        toast.success(`Saved ${backup.identities.length} identity file`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save identity");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const restored = await importLocalIdentities(await file.text());
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
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not restore");
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  return (
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="1">
        <Text weight="medium" size="2">
          Identity without an account
        </Text>
        <Text size="1" color="gray">
          {hosts.length > 0
            ? `You have an identity on ${hosts.length} server${hosts.length === 1 ? "" : "s"} that isn't tied to a Gryt account. A separate key per server, held only on this device.`
            : "Servers you join without a Gryt account give you an identity held only on this device."}
        </Text>
      </Flex>

      {hosts.length > 0 && (
        <Callout.Root color="amber" size="1">
          <Callout.Icon>
            <PiWarningFill size={15} />
          </Callout.Icon>
          <Callout.Text>
            Clearing your browser data deletes these, and there is no way to get
            them back — including any server you own. Save a copy somewhere safe.
          </Callout.Text>
        </Callout.Root>
      )}

      <Flex gap="2" wrap="wrap">
        <Button
          variant="soft"
          disabled={busy || hosts.length === 0}
          onClick={() => void handleSave()}
        >
          <PiDownloadSimple size={16} />
          Save my identity
        </Button>

        <Button
          variant="soft"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <PiUploadSimple size={16} />
          Restore from a file
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
      </Flex>

      <Text size="1" color="gray">
        The file is the identity. Anyone who has it can be you on those servers,
        so keep it as you would a password — and restoring one replaces whatever
        identity this device is using.
      </Text>
    </Flex>
  );
}
