import { Checkbox, Select, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";

import type { Channel, SidebarItem } from "@/settings/src/types/server";

import type { MemberInviteInfo } from "../hooks/useAdminActions";
import { BAN_DURATIONS } from "../lib/memberFacts";
import { ConfirmDialog } from "./ConfirmDialog";

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
  // Optional on both: a moderator acting quickly should not have to justify
  // themselves first. Given, the target sees it verbatim; it is logged either way.
  const [kickReason, setKickReason] = useState("");
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState<string>("permanent");
  const [banDeleteContent, setBanDeleteContent] = useState(true);
  const [banInvite, setBanInvite] = useState<MemberInviteInfo | null>(null);
  // Defaults to off. Revoking takes the link away from everybody who has it, so
  // it is a decision rather than a consequence.
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

  const deletedChannelName =
    pendingDeleteItem?.kind === "channel"
      ? channelById.get(pendingDeleteItem.channelId ?? pendingDeleteItem.id)?.name || "this channel"
      : null;

  return (
  <>
    <ConfirmDialog
      open={!!pendingDeleteItem}
      onOpenChange={(open) => { if (!open) cancelDelete(); }}
      title={`Delete ${pendingDeleteItem?.kind === "channel" ? "channel" : "item"}?`}
      description={
        deletedChannelName
          ? `This will permanently delete the channel "${deletedChannelName}" and all associated data. This action cannot be undone.`
          : "This will remove this item from the sidebar. This action cannot be undone."
      }
      confirmLabel="Delete"
      onConfirm={confirmDelete}
    />

    <ConfirmDialog
      open={!!pendingDisconnectUser}
      onOpenChange={(open) => { if (!open) setPendingDisconnectUser(null); }}
      title={`Disconnect ${pendingDisconnectUser?.nickname}?`}
      description={`This will disconnect ${pendingDisconnectUser?.nickname} from the voice channel.`}
      confirmLabel="Disconnect"
      onConfirm={() => {
        if (pendingDisconnectUser) onDisconnectUser(pendingDisconnectUser.id);
        setPendingDisconnectUser(null);
      }}
    />

    <ConfirmDialog
      open={!!pendingKickUser}
      onOpenChange={(open) => { if (!open) setPendingKickUser(null); }}
      title={`Kick ${pendingKickUser?.nickname}?`}
      description="They will be removed from the server and can rejoin later."
      confirmLabel="Kick"
      onConfirm={() => {
        if (pendingKickUser) onKickUser(pendingKickUser.id, kickReason);
        setPendingKickUser(null);
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs">Reason (optional — shown to them)</span>
        <TextField
          value={kickReason}
          onChange={(e) => setKickReason(e.target.value)}
          placeholder="Spamming the general channel"
          maxLength={200}
        />
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      open={!!pendingBanUser}
      onOpenChange={(open) => { if (!open) setPendingBanUser(null); }}
      title={`Ban ${pendingBanUser?.nickname}?`}
      description="They will be removed and cannot rejoin until the ban lifts."
      confirmLabel="Ban"
      confirmPhrase={pendingBanUser?.nickname}
      confirmPhraseLabel={<>Type <strong>{pendingBanUser?.nickname}</strong> to confirm</>}
      onConfirm={() => {
        if (!pendingBanUser) return;
        const minutes = BAN_DURATIONS.find((d) => d.value === banDuration)?.minutes ?? null;
        onBanUser(pendingBanUser.id, banReason, minutes, banDeleteContent, banRevokeInvite);
        setPendingBanUser(null);
      }}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs">Reason (optional — shown to them)</span>
        <TextField
          value={banReason}
          onChange={(e) => setBanReason(e.target.value)}
          placeholder="Repeated harassment after a warning"
          maxLength={200}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs">Duration</span>
        <Select
          value={banDuration}
          onValueChange={(v) => setBanDuration(String(v))}
          options={BAN_DURATIONS.map((d) => ({ label: d.label, value: d.value }))}
        />
      </div>
      <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Checkbox
          checked={banDeleteContent}
          onCheckedChange={(v) => setBanDeleteContent(v === true)}
        />
        Delete their messages and reactions
      </label>

      {/*
        Only when there is a live invite to close. A ban on somebody who
        arrived on one achieves less than it looks — an identity with no
        account behind it costs nothing to replace, so they can return on a
        new key with the same code. Offering it here is the moment it can be
        acted on.
      */}
      {banInvite?.code && banInvite.active && (
        <div className="flex flex-col gap-1">
          <label className="text-sm" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Checkbox
              checked={banRevokeInvite}
              onCheckedChange={(v) => setBanRevokeInvite(v === true)}
            />
            Revoke the invite they joined with
          </label>
          <span className="text-xs text-gryt-muted">
            They joined with <code className="font-mono text-xs text-gryt-text">{banInvite.code}</code>, still
            active and used {banInvite.usesConsumed}{" "}
            {banInvite.usesConsumed === 1 ? "time" : "times"}. Leaving it open
            lets them return on a new identity — and takes anyone else with
            the link too, so weigh it.
          </span>
        </div>
      )}
      {!banDeleteContent && (
        <span className="text-xs text-gryt-muted">
          Their messages stay. Unbanning restores access but never restores
          deleted messages, so this is the only chance to keep them.
        </span>
      )}
    </ConfirmDialog>
  </>
  );
};
