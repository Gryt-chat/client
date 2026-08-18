import { Alert, AlertDialog, Button, Chip, IconButton, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { PiHardDrivesFill, PiShieldCheckFill, PiTrashFill, PiWarningFill } from "react-icons/pi";

import type { BlockedServer, ServerPin } from "@/common";
import { forgetPin, listBlocked, listHostExpectations, listPins, unblockServer } from "@/common";

import { SettingsContainer } from "./settingsComponents";

function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Key ids are 43 characters of base64url, which nobody reads. Grouping them the
 * way SSH does makes two of them comparable at a glance, which is the only
 * thing anyone actually needs to do with one.
 */
function Fingerprint({ value }: { value: string }) {
  const grouped = (value.match(/.{1,8}/g) || [value]).join(" ");
  return (
    <Tooltip title="Click to copy">
      <code className="font-mono text-xs text-gryt-muted"
        style={{ cursor: "pointer", wordBreak: "break-all" }}
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => toast.success("Fingerprint copied"),
            () => toast.error("Could not copy"),
          );
        }}
      >
        {grouped}
      </code>
    </Tooltip>
  );
}

function BlockedRow({
  entry,
  firstPinnedAt,
  onUnblock,
}: {
  entry: BlockedServer;
  firstPinnedAt?: number;
  onUnblock: (entry: BlockedServer) => void;
}) {
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="flex flex-col gap-3 p-3" style={{ borderRadius: "var(--gryt-radius-sm)", background: "color-mix(in oklab, var(--gryt-danger-9) 5%, transparent)" }}>
      <div className="flex items-center gap-2">
        <PiWarningFill size={18} style={{ color: "var(--gryt-danger-11)", flexShrink: 0 }} />
        <span className="text-sm font-medium truncate" style={{ flex: 1, minWidth: 0 }}>
          {entry.host}
        </span>
        <Chip tone="danger">
          Blocked {formatDate(entry.blockedAt)}
        </Chip>
      </div>

      <span className="text-xs text-gryt-muted">
        {entry.reason === "key_mismatch"
          ? "A different server answered at this address than the one you joined before."
          : "This server proved its identity before, and then stopped."}
      </span>

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gryt-muted">
            Expected{firstPinnedAt ? `, first seen ${formatDate(firstPinnedAt)}` : ""}
          </span>
          <Fingerprint value={entry.expectedKeyId} />
        </div>

        {entry.keyId ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-gryt-muted">
              Got instead
            </span>
            <Fingerprint value={entry.keyId} />
          </div>
        ) : (
          <span className="text-xs text-gryt-muted">
            No identity was offered at all, so there is no fingerprint to compare.
          </span>
        )}
      </div>

      {/* The whole point of blocking is that someone makes an informed choice
          here. Telling them where to find the real answer beats asking them to
          guess from two strings. */}
      <Alert severity="info">
          {entry.keyId
            ? "If you rebuilt or replaced this server yourself, check its startup log — it prints its identity key on boot. Unblock only if that matches the fingerprint above."
            : "If you downgraded this server to an older version, that would explain it. Otherwise treat it as suspicious."}
        </Alert>

      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <Button tone="danger" size="xsmall"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setConfirm(true)}
        >
          Unblock
        </Button>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup>
          <AlertDialog.Title>Unblock {entry.host}?</AlertDialog.Title>
          <AlertDialog.Description>
            Gryt will forget the identity it expected here and trust whatever
            answers next time, the same as joining a server for the first time.
            Only do this if you know why the identity changed.
          </AlertDialog.Description>
          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close
              render={
                <Button tone="neutral" size="small">
                  Cancel
                </Button>
              }
            />
            <AlertDialog.Close
              render={
                <Button tone="danger" size="small"
                  onClick={() => {
                    onUnblock(entry);
                    setConfirm(false);
                  }}
                >
                  Unblock
                </Button>
              }
            />
          </div>
        </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function KnownRow({ pin, onForget }: { pin: ServerPin; onForget: (keyId: string) => void }) {
  const [confirm, setConfirm] = useState(false);

  return (
    <div className="flex items-center gap-3 py-3 px-3" style={{ borderRadius: "var(--gryt-radius-sm)", background: "var(--gryt-neutral-a2)" }}>
      <div className="flex items-center justify-center" style={{
          width: 36,
          height: 36,
          borderRadius: "var(--gryt-radius-sm)",
          background: "var(--gryt-accent-a3)",
          flexShrink: 0,
        }}>
        <PiShieldCheckFill size={18} style={{ color: "var(--gryt-accent-11)" }} />
      </div>

      <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
        <span className="text-sm font-medium truncate">
          {pin.lastHost}
        </span>
        <span className="text-xs text-gryt-muted">
          Trusted since {formatDate(pin.firstSeenAt)}
        </span>
        <Fingerprint value={pin.keyId} />
      </div>

      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <Tooltip title="Forget this server">
          <IconButton tone="danger" size="xsmall" onClick={() => setConfirm(true)}>
            <PiTrashFill size={16} />
          </IconButton>
        </Tooltip>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup>
          <AlertDialog.Title>Forget {pin.lastHost}?</AlertDialog.Title>
          <AlertDialog.Description>
            Gryt will stop recognising this server&apos;s identity. The next time
            you connect it will be treated as a server you have never joined, and
            whatever answers will be trusted.
          </AlertDialog.Description>
          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close
              render={
                <Button tone="neutral" size="small">
                  Cancel
                </Button>
              }
            />
            <AlertDialog.Close
              render={
                <Button tone="danger" size="small"
                  onClick={() => {
                    onForget(pin.keyId);
                    setConfirm(false);
                  }}
                >
                  Forget
                </Button>
              }
            />
          </div>
        </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

export function ServerIdentitySettings() {
  const [pins, setPins] = useState<ServerPin[]>([]);
  const [blocked, setBlocked] = useState<BlockedServer[]>([]);

  const refresh = useCallback(() => {
    setPins(Object.values(listPins()).sort((a, b) => b.lastSeenAt - a.lastSeenAt));
    setBlocked(listBlocked().slice().sort((a, b) => b.blockedAt - a.blockedAt));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleUnblock = useCallback(
    (entry: BlockedServer) => {
      unblockServer(entry);

      // Unblocking is someone saying "this server was replaced", so the
      // identity it replaced is retired too. Without this the old pin lingers
      // with nothing pointing at it, and Known servers shows two rows for the
      // same address with different fingerprints — which reads as a problem
      // rather than as history.
      //
      // Only when nothing else still expects that key: the same server
      // legitimately answers at more than one address, and forgetting it would
      // un-trust the others.
      const stillInUse = Object.values(listHostExpectations()).includes(entry.expectedKeyId);
      if (!stillInUse) forgetPin(entry.expectedKeyId);

      refresh();
      toast.success(`${entry.host} unblocked`);
    },
    [refresh],
  );

  const handleForget = useCallback(
    (keyId: string) => {
      forgetPin(keyId);
      refresh();
      toast.success("Server forgotten");
    },
    [refresh],
  );

  return (
    <SettingsContainer>
      <h2 className="text-lg">
        Server identities
      </h2>

      <div className="flex flex-col gap-3">
        <span className="text-xs text-gryt-muted">
          Gryt remembers each server&apos;s identity key the first time you join,
          so it can tell that a server which moved to a new address is still the
          same one — and notice when something else answers in its place.
        </span>

        {blocked.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">
                Blocked
              </span>
              <Chip tone="danger">
                {blocked.length}
              </Chip>
            </div>
            {blocked.map((entry) => (
              <BlockedRow
                key={`${entry.host}:${entry.keyId ?? "none"}`}
                entry={entry}
                firstPinnedAt={pins.find((p) => p.keyId === entry.expectedKeyId)?.firstSeenAt}
                onUnblock={handleUnblock}
              />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="font-medium text-sm">
            Known servers
          </span>
          <Chip tone="neutral">
            {pins.length}
          </Chip>
        </div>

        {pins.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8" style={{ borderRadius: "var(--gryt-radius-sm)", border: "1px dashed var(--gryt-neutral-a6)" }}>
            <PiHardDrivesFill size={32} style={{ color: "var(--gryt-neutral-a8)" }} />
            <span className="text-sm text-gryt-muted">
              No server identities remembered yet
            </span>
          </div>
        ) : (
          pins.map((pin) => <KnownRow key={pin.keyId} pin={pin} onForget={handleForget} />)
        )}
      </div>
    </SettingsContainer>
  );
}
