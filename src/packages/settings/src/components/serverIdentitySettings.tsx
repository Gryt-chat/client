import { Button, Chip, IconButton, Tooltip } from "@gryt/ui";
import {
  AlertDialog,
  Callout,
  Code,
  Flex,
  Heading,
  Text,
} from "@radix-ui/themes";
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
      <Code
        size="1"
        variant="soft"
        style={{ cursor: "pointer", wordBreak: "break-all" }}
        onClick={() => {
          navigator.clipboard?.writeText(value).then(
            () => toast.success("Fingerprint copied"),
            () => toast.error("Could not copy"),
          );
        }}
      >
        {grouped}
      </Code>
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
    <Flex
      direction="column"
      gap="3"
      p="3"
      style={{ borderRadius: "var(--radius-2)", background: "var(--red-a2)" }}
    >
      <Flex align="center" gap="2">
        <PiWarningFill size={18} style={{ color: "var(--red-11)", flexShrink: 0 }} />
        <Text size="2" weight="medium" style={{ flex: 1, minWidth: 0 }} truncate>
          {entry.host}
        </Text>
        <Chip tone="danger">
          Blocked {formatDate(entry.blockedAt)}
        </Chip>
      </Flex>

      <Text size="1" color="gray">
        {entry.reason === "key_mismatch"
          ? "A different server answered at this address than the one you joined before."
          : "This server proved its identity before, and then stopped."}
      </Text>

      <Flex direction="column" gap="2">
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            Expected{firstPinnedAt ? `, first seen ${formatDate(firstPinnedAt)}` : ""}
          </Text>
          <Fingerprint value={entry.expectedKeyId} />
        </Flex>

        {entry.keyId ? (
          <Flex direction="column" gap="1">
            <Text size="1" color="gray">
              Got instead
            </Text>
            <Fingerprint value={entry.keyId} />
          </Flex>
        ) : (
          <Text size="1" color="gray">
            No identity was offered at all, so there is no fingerprint to compare.
          </Text>
        )}
      </Flex>

      {/* The whole point of blocking is that someone makes an informed choice
          here. Telling them where to find the real answer beats asking them to
          guess from two strings. */}
      <Callout.Root size="1" color="gray" variant="surface">
        <Callout.Text size="1">
          {entry.keyId
            ? "If you rebuilt or replaced this server yourself, check its startup log — it prints its identity key on boot. Unblock only if that matches the fingerprint above."
            : "If you downgraded this server to an older version, that would explain it. Otherwise treat it as suspicious."}
        </Callout.Text>
      </Callout.Root>

      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <Button tone="danger" size="xsmall"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setConfirm(true)}
        >
          Unblock
        </Button>
        <AlertDialog.Content maxWidth="460px">
          <AlertDialog.Title>Unblock {entry.host}?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Gryt will forget the identity it expected here and trust whatever
            answers next time, the same as joining a server for the first time.
            Only do this if you know why the identity changed.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button tone="neutral" size="small">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button tone="danger" size="small"
                onClick={() => {
                  onUnblock(entry);
                  setConfirm(false);
                }}
              >
                Unblock
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}

function KnownRow({ pin, onForget }: { pin: ServerPin; onForget: (keyId: string) => void }) {
  const [confirm, setConfirm] = useState(false);

  return (
    <Flex
      align="center"
      gap="3"
      py="3"
      px="3"
      style={{ borderRadius: "var(--radius-2)", background: "var(--gray-a2)" }}
    >
      <Flex
        align="center"
        justify="center"
        style={{
          width: 36,
          height: 36,
          borderRadius: "var(--radius-2)",
          background: "var(--accent-a3)",
          flexShrink: 0,
        }}
      >
        <PiShieldCheckFill size={18} style={{ color: "var(--accent-11)" }} />
      </Flex>

      <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
        <Text size="2" weight="medium" truncate>
          {pin.lastHost}
        </Text>
        <Text size="1" color="gray">
          Trusted since {formatDate(pin.firstSeenAt)}
        </Text>
        <Fingerprint value={pin.keyId} />
      </Flex>

      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <Tooltip title="Forget this server">
          <IconButton tone="danger" size="xsmall" onClick={() => setConfirm(true)}>
            <PiTrashFill size={16} />
          </IconButton>
        </Tooltip>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>Forget {pin.lastHost}?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Gryt will stop recognising this server&apos;s identity. The next time
            you connect it will be treated as a server you have never joined, and
            whatever answers will be trusted.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button tone="neutral" size="small">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button tone="danger" size="small"
                onClick={() => {
                  onForget(pin.keyId);
                  setConfirm(false);
                }}
              >
                Forget
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
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
      <Heading as="h2" size="4">
        Server identities
      </Heading>

      <Flex direction="column" gap="3">
        <Text size="1" color="gray">
          Gryt remembers each server&apos;s identity key the first time you join,
          so it can tell that a server which moved to a new address is still the
          same one — and notice when something else answers in its place.
        </Text>

        {blocked.length > 0 && (
          <Flex direction="column" gap="2">
            <Flex align="center" justify="between">
              <Text weight="medium" size="2">
                Blocked
              </Text>
              <Chip tone="danger">
                {blocked.length}
              </Chip>
            </Flex>
            {blocked.map((entry) => (
              <BlockedRow
                key={`${entry.host}:${entry.keyId ?? "none"}`}
                entry={entry}
                firstPinnedAt={pins.find((p) => p.keyId === entry.expectedKeyId)?.firstSeenAt}
                onUnblock={handleUnblock}
              />
            ))}
          </Flex>
        )}

        <Flex align="center" justify="between">
          <Text weight="medium" size="2">
            Known servers
          </Text>
          <Chip tone="neutral">
            {pins.length}
          </Chip>
        </Flex>

        {pins.length === 0 ? (
          <Flex
            direction="column"
            align="center"
            gap="2"
            py="6"
            style={{ borderRadius: "var(--radius-2)", border: "1px dashed var(--gray-a6)" }}
          >
            <PiHardDrivesFill size={32} style={{ color: "var(--gray-a8)" }} />
            <Text size="2" color="gray">
              No server identities remembered yet
            </Text>
          </Flex>
        ) : (
          pins.map((pin) => <KnownRow key={pin.keyId} pin={pin} onForget={handleForget} />)
        )}
      </Flex>
    </SettingsContainer>
  );
}
