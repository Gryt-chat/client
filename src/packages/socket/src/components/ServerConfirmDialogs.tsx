import { AlertDialog, Button, Checkbox, Select, TextField } from "@gryt/ui";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useState } from "react";

import type { Channel, SidebarItem } from "@/settings/src/types/server";

import type { MemberInviteInfo } from "../hooks/useAdminActions";

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
  onBanUser: (id: string, reason?: string, expiresInMinutes?: number | null, deleteContent?: boolean, revokeInvite?: boolean) => void;
  /** How the member got in, so the ban dialog can offer to close that door too. */
  fetchMemberInvite?: (targetServerUserId: string) => Promise<MemberInviteInfo | null>;
}

export const ServerConfirmDialogs = ({
  pendingDeleteItem, channelById, cancelDelete, confirmDelete,
  pendingDisconnectUser, setPendingDisconnectUser, onDisconnectUser,
  pendingKickUser, setPendingKickUser, onKickUser,
  pendingBanUser, setPendingBanUser, onBanUser, fetchMemberInvite,
}: ServerConfirmDialogsProps) => {
  // Optional on both, per Sivert: a moderator acting quickly should not be made
  // to justify themselves first. When one is given the target sees it verbatim,
  // and it goes into the audit log either way.
  const [kickReason, setKickReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState<string>("permanent");
  const [banDeleteContent, setBanDeleteContent] = useState(true);
  const [banInvite, setBanInvite] = useState<MemberInviteInfo | null>(null);
  // Defaults to off. Revoking takes the link away from everybody who has it,
  // not just the person being banned, so it is a decision rather than a
  // consequence.
  const [banRevokeInvite, setBanRevokeInvite] = useState(false);

  // Asked when the dialog opens, so the answer is there by the time somebody
  // has finished typing a reason.
  useEffect(() => {
    if (!pendingBanUser || !fetchMemberInvite) {
      setBanInvite(null);
      setBanRevokeInvite(false);
      return;
    }
    let cancelled = false;
    setBanInvite(null);
    setBanRevokeInvite(false);
    fetchMemberInvite(pendingBanUser.id)
      .then((info) => {
        if (!cancelled) setBanInvite(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pendingBanUser, fetchMemberInvite]);

  // Clear when the dialog opens rather than when it closes, so a reason typed
  // for one person can never be carried onto the next.
  useEffect(() => { if (pendingKickUser) setKickReason(""); }, [pendingKickUser]);
  useEffect(() => {
    if (pendingBanUser) { setBanReason(""); setBanDuration("permanent"); setBanDeleteContent(true); }
  }, [pendingBanUser]);

  return (
  <>
    <AlertDialog.Root open={!!pendingDeleteItem} onOpenChange={(open) => { if (!open) cancelDelete(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup className="max-w-105">
        <AlertDialog.Title>Delete {pendingDeleteItem?.kind === "channel" ? "channel" : "item"}?</AlertDialog.Title>
        <AlertDialog.Description>
          {pendingDeleteItem?.kind === "channel"
            ? `This will permanently delete the channel "${channelById.get(pendingDeleteItem.channelId ?? pendingDeleteItem.id)?.name || "this channel"}" and all associated data. This action cannot be undone.`
            : "This will remove this item from the sidebar. This action cannot be undone."}
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Close render={<span />}>
            <Button size="small">Cancel</Button>
          </AlertDialog.Close>
          <AlertDialog.Close render={<span />}>
            <Button size="small" onClick={confirmDelete}>Delete</Button>
          </AlertDialog.Close>
        </Flex>
      </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>

    <AlertDialog.Root open={!!pendingDisconnectUser} onOpenChange={(open) => { if (!open) setPendingDisconnectUser(null); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup className="max-w-105">
        <AlertDialog.Title>Disconnect {pendingDisconnectUser?.nickname}?</AlertDialog.Title>
        <AlertDialog.Description>
          This will disconnect {pendingDisconnectUser?.nickname} from the voice channel.
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Close render={<span />}>
            <Button size="small">Cancel</Button>
          </AlertDialog.Close>
          <AlertDialog.Close render={<span />}>
            <Button size="small" onClick={() => { if (pendingDisconnectUser) { onDisconnectUser(pendingDisconnectUser.id); setPendingDisconnectUser(null); } }}>Disconnect</Button>
          </AlertDialog.Close>
        </Flex>
      </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>

    <AlertDialog.Root open={!!pendingKickUser} onOpenChange={(open) => { if (!open) setPendingKickUser(null); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup className="max-w-105">
        <AlertDialog.Title>Kick {pendingKickUser?.nickname}?</AlertDialog.Title>
        <AlertDialog.Description>
          They will be removed from the server and can rejoin later.
        </AlertDialog.Description>
        <Flex direction="column" gap="1" mt="3">
          <Text size="1">Reason (optional — shown to them)</Text>
          <TextField
            value={kickReason}
            onChange={(e) => setKickReason(e.target.value)}
            placeholder="Spamming the general channel"
            maxLength={200}
          />
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Close render={<span />}>
            <Button size="small">Cancel</Button>
          </AlertDialog.Close>
          <AlertDialog.Close render={<span />}>
            <Button size="small" onClick={() => { if (pendingKickUser) { onKickUser(pendingKickUser.id, kickReason); setPendingKickUser(null); } }}>Kick</Button>
          </AlertDialog.Close>
        </Flex>
      </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>

    <AlertDialog.Root open={!!pendingBanUser} onOpenChange={(open) => { if (!open) setPendingBanUser(null); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup className="max-w-105">
        <AlertDialog.Title>Ban {pendingBanUser?.nickname}?</AlertDialog.Title>
        <AlertDialog.Description>
          They will be removed and cannot rejoin until the ban lifts.
        </AlertDialog.Description>
        <Flex direction="column" gap="1" mt="3">
          <Text size="1">Reason (optional — shown to them)</Text>
          <TextField
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            placeholder="Repeated harassment after a warning"
            maxLength={200}
          />
        </Flex>
        <Flex direction="column" gap="1" mt="3">
          <Text size="1">Duration</Text>
          <Select
            value={banDuration}
            onValueChange={(v) => setBanDuration(String(v))}
            options={BAN_DURATIONS.map((d) => ({ label: d.label, value: d.value }))}
          />
        </Flex>
        <Text as="label" size="2" mt="3" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Checkbox
            checked={banDeleteContent}
            onCheckedChange={(v) => setBanDeleteContent(v === true)}
          />
          Delete their messages and reactions
        </Text>

        {/*
          Only when there is a live invite to close. A ban on somebody who
          arrived on one achieves less than it looks — an identity with no
          account behind it costs nothing to replace, so they can return on a
          new key with the same code. Offering it here is the moment it can be
          acted on.
        */}
        {banInvite?.code && banInvite.active && (
          <>
            <Text as="label" size="2" mt="3" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Checkbox
                checked={banRevokeInvite}
                onCheckedChange={(v) => setBanRevokeInvite(v === true)}
              />
              Revoke the invite they joined with
            </Text>
            <Text size="1" mt="1" as="div">
              They joined with <code className="font-mono text-xs text-gryt-text">{banInvite.code}</code>, still
              active and used {banInvite.usesConsumed}{" "}
              {banInvite.usesConsumed === 1 ? "time" : "times"}. Leaving it open
              lets them return on a new identity — and takes anyone else with
              the link too, so weigh it.
            </Text>
          </>
        )}
        {!banDeleteContent && (
          <Text size="1" mt="1" as="div">
            Their messages stay. Unbanning restores access but never restores
            deleted messages, so this is the only chance to keep them.
          </Text>
        )}
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Close render={<span />}>
            <Button size="small">Cancel</Button>
          </AlertDialog.Close>
          <AlertDialog.Close render={<span />}>
            <Button size="small"
              onClick={() => {
                if (!pendingBanUser) return;
                const minutes = BAN_DURATIONS.find((d) => d.value === banDuration)?.minutes ?? null;
                onBanUser(pendingBanUser.id, banReason, minutes, banDeleteContent, banRevokeInvite);
                setPendingBanUser(null);
              }}
            >
              Ban
            </Button>
          </AlertDialog.Close>
        </Flex>
      </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </>
  );
};
