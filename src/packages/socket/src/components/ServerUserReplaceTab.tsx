import { AlertDialog, Avatar, Button, Surface, TextField } from "@gryt/ui";
import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { getUploadsFileUrl, resolveAvatarSrc } from "@/common";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { useSockets } from "../hooks/useSockets";
import type { MemberInfo } from "./MemberSidebar";

interface ReplaceSuccessPayload {
  targetServerUserId: string;
  oldGrytUserId: string;
  newGrytUserId: string;
  ownerUpdated: boolean;
}

function formatJoinDate(raw?: string | Date): string {
  if (!raw) return "Unknown";
  const d = typeof raw === "string" ? new Date(raw) : raw;
  if (isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function filterMembers(members: MemberInfo[], query: string): MemberInfo[] {
  if (!query) return members.slice(0, 12);
  const q = query.toLowerCase();
  return members
    .filter(
      (m) =>
        m.nickname.toLowerCase().includes(q) ||
        m.serverUserId.toLowerCase().includes(q),
    )
    .slice(0, 12);
}

function MemberDropdownItem({
  member,
  host,
  onSelect,
}: {
  member: MemberInfo;
  host: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(member.serverUserId);
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: "var(--gryt-radius-sm)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gryt-neutral-4)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <Avatar
        size="small"
        className="h-6 w-6 text-[10px]"
        fallback={member.nickname[0]}
        src={resolveAvatarSrc(member.avatarFileId ? getUploadsFileUrl(host, member.avatarFileId, { thumb: true }) : undefined, member.nickname, member.avatarWorn)}
        style={{ flexShrink: 0 }}
      />
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
        <span className="text-sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {member.nickname}
        </span>
        <span className="text-xs">
          Joined {formatJoinDate(member.createdAt)}
        </span>
      </div>
    </div>
  );
}

function MemberCombobox({
  value,
  onChange,
  members,
  host,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  members: MemberInfo[];
  host: string;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filtered = filterMembers(members, value);
  const selectedMember = members.find((m) => m.serverUserId === value);

  const displayValue = selectedMember ? selectedMember.nickname : value;

  const handleSelect = useCallback(
    (id: string) => {
      onChange(id);
      setFocused(false);
    },
    [onChange],
  );

  return (
    <div style={{ position: "relative" }}>
      <div className="flex gap-2 items-center">
        {selectedMember && (
          <Avatar
            size="small"
            className="h-6 w-6 text-[10px]"
            fallback={selectedMember.nickname[0]}
            src={resolveAvatarSrc(selectedMember.avatarFileId ? getUploadsFileUrl(host, selectedMember.avatarFileId, { thumb: true }) : undefined, selectedMember.nickname, selectedMember.avatarWorn)}
            style={{ flexShrink: 0 }}
          />
        )}
        <TextField
          style={{ flex: 1 }}
          placeholder={placeholder}
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
            setFocused(true);
            if (selectedMember) onChange("");
          }}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => setFocused(false), 150);
          }}
        />
      </div>
      {focused && filtered.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "var(--gryt-neutral-2)",
            border: "1px solid var(--gryt-neutral-6)",
            borderRadius: "var(--gryt-radius-md)",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
            maxHeight: 220,
            overflowY: "auto",
            zIndex: 50,
            padding: 4,
          }}
        >
          {filtered.map((m) => (
            <MemberDropdownItem
              key={m.serverUserId}
              member={m}
              host={host}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ServerUserReplaceTab({
  host,
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  const { memberLists, requestMemberList } = useSockets();
  const members = host ? memberLists[host] || [] : [];

  const [targetServerUserId, setTargetServerUserId] = useState("");
  const [newGrytUserId, setNewGrytUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => {
    if (!socket?.connected) return;
    requestMemberList(host);
  };

  useSocketEvent<ReplaceSuccessPayload>(socket, "server:user:replace:success", (payload) => {
    setSubmitting(false);
    toast.success(
      `Replaced identity for ${payload.targetServerUserId}.` +
        (payload.ownerUpdated ? " Server ownership was transferred." : ""),
    );
    setTargetServerUserId("");
    setNewGrytUserId("");
    refresh();
  });

  const handleReplace = () => {
    if (!socket?.connected) return toast.error("Not connected to the server yet.");
    if (!accessToken) return toast.error("Join the server first.");
    if (!targetServerUserId) return toast.error("Select a user to replace.");
    if (!newGrytUserId.trim()) return toast.error("Enter the new Gryt User ID.");

    setSubmitting(true);
    socket.emit("server:user:replace", {
      accessToken,
      targetServerUserId,
      newGrytUserId: newGrytUserId.trim(),
    });

    const timeout = setTimeout(() => setSubmitting(false), 10_000);
    const cleanup = () => clearTimeout(timeout);
    socket.once("server:user:replace:success", cleanup);
    socket.once("server:error", () => {
      setSubmitting(false);
      cleanup();
    });
  };

  const selectedMember = members.find((m) => m.serverUserId === targetServerUserId);

  return (
    <div className="flex flex-col gap-4">
      <span className="text-sm">
        Re-map a user&apos;s Keycloak identity (gryt_user_id) while keeping their server user ID, messages, roles, and
        all other data intact. This is useful when a user re-registers and gets a new Keycloak account.
      </span>

      <Surface>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-bold mb-1">
              Old user (current member)
            </p>
            <MemberCombobox
              value={targetServerUserId}
              onChange={setTargetServerUserId}
              members={members}
              host={host}
              placeholder="Search by name or ID…"
            />
          </div>

          <div>
            <p className="text-sm font-bold mb-1">
              New Gryt User ID
            </p>
            <MemberCombobox
              value={newGrytUserId}
              onChange={setNewGrytUserId}
              members={members}
              host={host}
              placeholder="Paste ID or search for a member…"
            />
            <p className="text-xs mt-1">
              The Keycloak subject ID from the new account, or select an existing member.
            </p>
          </div>

          <div className="flex justify-end mt-2">
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button size="small" disabled={submitting || !targetServerUserId || !newGrytUserId.trim()}>
                  {submitting ? "Replacing…" : "Replace identity"}
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Backdrop />
                <AlertDialog.Popup>
                <AlertDialog.Title>Replace user identity?</AlertDialog.Title>
                <AlertDialog.Description>
                  This will permanently re-bind{" "}
                  <strong>{selectedMember?.nickname ?? targetServerUserId}</strong>&apos;s server identity to a new
                  Keycloak account. The old account will lose access and any active sessions will be revoked.
                </AlertDialog.Description>
                <div className="flex gap-3 mt-4 justify-end">
                  <AlertDialog.Close
                    render={
                      <Button size="small">
                        Cancel
                      </Button>
                    }
                  />
                  <AlertDialog.Close
                    render={
                      <Button size="small" onClick={handleReplace} disabled={submitting}>
                        Confirm replace
                      </Button>
                    }
                  />
                </div>
              </AlertDialog.Popup>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          </div>
        </div>
      </Surface>
    </div>
  );
}
