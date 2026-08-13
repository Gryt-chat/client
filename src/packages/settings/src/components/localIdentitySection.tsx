import { Alert, Button } from "@gryt/ui";
import { Flex, Text } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  PiDownloadSimple,
  PiKeyholeFill,
  PiUploadSimple,
  PiWarningFill,
} from "react-icons/pi";

import {
  authoriseDeviceFromBackup,
  exportLocalIdentities,
  importLocalIdentities,
  listDelegations,
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
  const [delegated, setDelegated] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
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
        if (mode.current === "authorise") {
          const authorised = await authoriseDeviceFromBackup(await file.text());
          refresh();
          toast.success(
            `This device can now act as that identity on ${authorised.length} server${authorised.length === 1 ? "" : "s"}. Your key was not saved here.`,
            { duration: 8000 },
          );
          return;
        }

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
        <Alert severity="warning"><span className="inline-flex items-start gap-2"><PiWarningFill size={15} />Clearing your browser data deletes these, and there is no way to get
            them back — including any server you own. Save a copy somewhere safe.</span></Alert>
      )}

      <Flex gap="2" wrap="wrap">
        <Button tone="neutral" size="small"
          disabled={busy || hosts.length === 0}
          onClick={() => void handleSave()}
        >
          <PiDownloadSimple size={16} />
          Save my identity
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
      </Flex>

      {delegated.length > 0 && (
        <Text size="1" color="gray">
          This device is authorised to act as a saved identity on{" "}
          {delegated.length} server{delegated.length === 1 ? "" : "s"}. The
          authorisation runs out after 30 days, and renewing it means picking
          the file again.
        </Text>
      )}

      <Text size="1" color="gray">
        The file is the identity — anyone who has it can be you on those
        servers, so keep it as you would a password.
      </Text>

      <Text size="1" color="gray">
        <strong>Restore</strong> makes this device that identity, by copying the
        key into it. <strong>Authorise</strong> leaves the key in the file and
        lets it vouch for this device instead, so the key is never stored here
        and the permission expires on its own. Prefer authorising on a machine
        you do not fully control.
      </Text>
    </Flex>
  );
}
