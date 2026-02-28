import { AlertDialog, Avatar, Button, Card, Flex, Text, TextField } from "@radix-ui/themes";
import { useCallback, useRef, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { getUploadsFileUrl } from "@/common";

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
        borderRadius: "var(--radius-2)",
        cursor: "pointer",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-4)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <Avatar
        size="1"
        fallback={member.nickname[0]}
        src={member.avatarFileId ? getUploadsFileUrl(host, member.avatarFileId) : undefined}
        style={{ flexShrink: 0 }}
      />
      <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
        <Text size="2" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {member.nickname}
        </Text>
        <Text size="1" color="gray">
          Joined {formatJoinDate(member.createdAt)}
        </Text>
      </Flex>
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
      <Flex gap="2" align="center">
        {selectedMember && (
          <Avatar
            size="1"
            fallback={selectedMember.nickname[0]}
            src={selectedMember.avatarFileId ? getUploadsFileUrl(host, selectedMember.avatarFileId) : undefined}
            style={{ flexShrink: 0 }}
          />
        )}
        <TextField.Root
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
      </Flex>
      {focused && filtered.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "var(--color-panel-solid)",
            border: "1px solid var(--gray-6)",
            borderRadius: "var(--radius-3)",
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
    <Flex direction="column" gap="4">
      <Text size="2" color="gray">
        Re-map a user&apos;s Keycloak identity (gryt_user_id) while keeping their server user ID, messages, roles, and
        all other data intact. This is useful when a user re-registers and gets a new Keycloak account.
      </Text>

      <Card>
        <Flex direction="column" gap="3">
          <div>
            <Text size="2" weight="bold" mb="1" as="p">
              Old user (current member)
            </Text>
            <MemberCombobox
              value={targetServerUserId}
              onChange={setTargetServerUserId}
              members={members}
              host={host}
              placeholder="Search by name or ID…"
            />
          </div>

          <div>
            <Text size="2" weight="bold" mb="1" as="p">
              New Gryt User ID
            </Text>
            <MemberCombobox
              value={newGrytUserId}
              onChange={setNewGrytUserId}
              members={members}
              host={host}
              placeholder="Paste ID or search for a member…"
            />
            <Text size="1" color="gray" mt="1" as="p">
              The Keycloak subject ID from the new account, or select an existing member.
            </Text>
          </div>

          <Flex justify="end" mt="2">
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button color="red" disabled={submitting || !targetServerUserId || !newGrytUserId.trim()}>
                  {submitting ? "Replacing…" : "Replace identity"}
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="480px">
                <AlertDialog.Title>Replace user identity?</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  This will permanently re-bind{" "}
                  <strong>{selectedMember?.nickname ?? targetServerUserId}</strong>&apos;s server identity to a new
                  Keycloak account. The old account will lose access and any active sessions will be revoked.
                </AlertDialog.Description>
                <Flex gap="3" mt="4" justify="end">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      Cancel
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button color="red" onClick={handleReplace} disabled={submitting}>
                      Confirm replace
                    </Button>
                  </AlertDialog.Action>
                </Flex>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </Flex>
        </Flex>
      </Card>
    </Flex>
  );
}
