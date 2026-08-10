import { AlertDialog, Button, Checkbox, Flex, Select, Text, TextField } from "@radix-ui/themes";
import { useEffect, useState } from "react";

import type { Channel, SidebarItem } from "@/settings/src/types/server";

/**
 * Ban lengths, as minutes. Null is permanent, which is what the server stores
 * as a null expiry — so the two agree without the client knowing the encoding.
 */
const BAN_DURATIONS: { value: string; label: string; minutes: number | null }[] = [
  { value: "1h", label: "1 hour", minutes: 60 },
  { value: "1d", label: "1 day", minutes: 1440 },
  { value: "7d", label: "7 days", minutes: 10080 },
  { value: "30d", label: "30 days", minutes: 43200 },
  { value: "permanent", label: "Permanent", minutes: null },
];

interface PendingUser {
  id: string;
  nickname: string;
}

interface ServerConfirmDialogsProps {
  pendingDeleteItem: SidebarItem | null;
  channelById: Map<string, Channel>;
  cancelDelete: () => void;
  confirmDelete: () => void;
  pendingDisconnectUser: PendingUser | null;
  setPendingDisconnectUser: (v: PendingUser | null) => void;
  onDisconnectUser: (id: string) => void;
  pendingKickUser: PendingUser | null;
  setPendingKickUser: (v: PendingUser | null) => void;
  onKickUser: (id: string, reason?: string) => void;
  pendingBanUser: PendingUser | null;
  setPendingBanUser: (v: PendingUser | null) => void;
  onBanUser: (id: string, reason?: string, expiresInMinutes?: number | null, deleteContent?: boolean) => void;
}

export const ServerConfirmDialogs = ({
  pendingDeleteItem, channelById, cancelDelete, confirmDelete,
  pendingDisconnectUser, setPendingDisconnectUser, onDisconnectUser,
  pendingKickUser, setPendingKickUser, onKickUser,
  pendingBanUser, setPendingBanUser, onBanUser,
}: ServerConfirmDialogsProps) => {
  // Optional on both, per Sivert: a moderator acting quickly should not be made
  // to justify themselves first. When one is given the target sees it verbatim,
  // and it goes into the audit log either way.
  const [kickReason, setKickReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState<string>("permanent");
  const [banDeleteContent, setBanDeleteContent] = useState(true);

  // Clear when the dialog opens rather than when it closes, so a reason typed
  // for one person can never be carried onto the next.
  useEffect(() => { if (pendingKickUser) setKickReason(""); }, [pendingKickUser]);
  useEffect(() => {
    if (pendingBanUser) { setBanReason(""); setBanDuration("permanent"); setBanDeleteContent(true); }
  }, [pendingBanUser]);

  return (
  <>
    <AlertDialog.Root open={!!pendingDeleteItem} onOpenChange={(open) => { if (!open) cancelDelete(); }}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Delete {pendingDeleteItem?.kind === "channel" ? "channel" : "item"}?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          {pendingDeleteItem?.kind === "channel"
            ? `This will permanently delete the channel "${channelById.get(pendingDeleteItem.channelId ?? pendingDeleteItem.id)?.name || "this channel"}" and all associated data. This action cannot be undone.`
            : "This will remove this item from the sidebar. This action cannot be undone."}
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">Cancel</Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" color="red" onClick={confirmDelete}>Delete</Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <AlertDialog.Root open={!!pendingDisconnectUser} onOpenChange={(open) => { if (!open) setPendingDisconnectUser(null); }}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Disconnect {pendingDisconnectUser?.nickname}?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          This will disconnect {pendingDisconnectUser?.nickname} from the voice channel.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">Cancel</Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" color="red" onClick={() => { if (pendingDisconnectUser) { onDisconnectUser(pendingDisconnectUser.id); setPendingDisconnectUser(null); } }}>Disconnect</Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <AlertDialog.Root open={!!pendingKickUser} onOpenChange={(open) => { if (!open) setPendingKickUser(null); }}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Kick {pendingKickUser?.nickname}?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          They will be removed from the server and can rejoin later.
        </AlertDialog.Description>
        <Flex direction="column" gap="1" mt="3">
          <Text size="1" color="gray">Reason (optional — shown to them)</Text>
          <TextField.Root
            value={kickReason}
            onChange={(e) => setKickReason(e.target.value)}
            placeholder="Spamming the general channel"
            maxLength={200}
          />
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">Cancel</Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button variant="solid" color="red" onClick={() => { if (pendingKickUser) { onKickUser(pendingKickUser.id, kickReason); setPendingKickUser(null); } }}>Kick</Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <AlertDialog.Root open={!!pendingBanUser} onOpenChange={(open) => { if (!open) setPendingBanUser(null); }}>
      <AlertDialog.Content maxWidth="420px">
        <AlertDialog.Title>Ban {pendingBanUser?.nickname}?</AlertDialog.Title>
        <AlertDialog.Description size="2">
          They will be removed and cannot rejoin until the ban lifts.
        </AlertDialog.Description>
        <Flex direction="column" gap="1" mt="3">
          <Text size="1" color="gray">Reason (optional — shown to them)</Text>
          <TextField.Root
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder="Repeated harassment after a warning"
            maxLength={200}
          />
        </Flex>
        <Flex direction="column" gap="1" mt="3">
          <Text size="1" color="gray">Duration</Text>
          <Select.Root value={banDuration} onValueChange={setBanDuration}>
            <Select.Trigger />
            <Select.Content>
              {BAN_DURATIONS.map((d) => (
                <Select.Item key={d.value} value={d.value}>{d.label}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Text as="label" size="2" mt="3" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Checkbox
            checked={banDeleteContent}
            onCheckedChange={(v) => setBanDeleteContent(v === true)}
          />
          Delete their messages and reactions
        </Text>
        {!banDeleteContent && (
          <Text size="1" color="gray" mt="1" as="div">
            Their messages stay. Unbanning restores access but never restores
            deleted messages, so this is the only chance to keep them.
          </Text>
        )}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">Cancel</Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button
              variant="solid"
              color="red"
              onClick={() => {
                if (!pendingBanUser) return;
                const minutes = BAN_DURATIONS.find((d) => d.value === banDuration)?.minutes ?? null;
                onBanUser(pendingBanUser.id, banReason, minutes, banDeleteContent);
                setPendingBanUser(null);
              }}
            >
              Ban
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  </>
  );
};
