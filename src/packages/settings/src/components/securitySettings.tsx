import {
  AlertDialog,
  Badge,
  Button,
  Flex,
  Heading,
  IconButton,
  Spinner,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { PiCheck, PiKey, PiPencilSimple, PiPlus, PiTrash, PiX } from "react-icons/pi";

import type { KeycloakCredential } from "@/common";
import {
  deleteCredential,
  fetchCredentials,
  startPasskeySetup,
  updateCredentialLabel,
} from "@/common";

import { SettingsContainer } from "./settingsComponents";

const PASSKEY_TYPE = "webauthn-passwordless";

function formatDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface PasskeyRowProps {
  credential: KeycloakCredential;
  onDelete: (id: string) => void;
  onRename: (id: string, label: string) => void;
  deleting: boolean;
}

function PasskeyRow({ credential, onDelete, onRename, deleting }: PasskeyRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(credential.userLabel);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed === credential.userLabel) {
      setEditing(false);
      setDraft(credential.userLabel);
      return;
    }
    setSaving(true);
    try {
      onRename(credential.id, trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [draft, credential.userLabel, credential.id, onRename]);

  return (
    <Flex
      align="center"
      gap="3"
      py="3"
      px="3"
      style={{
        borderRadius: "var(--radius-2)",
        background: "var(--gray-a2)",
      }}
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
        <PiKey size={18} style={{ color: "var(--accent-11)" }} />
      </Flex>

      <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <Flex align="center" gap="1">
            <TextField.Root
              ref={inputRef}
              size="1"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(credential.userLabel);
                }
              }}
              disabled={saving}
              style={{ flex: 1 }}
            />
            <IconButton size="1" variant="soft" onClick={handleSave} disabled={saving}>
              <PiCheck size={14} />
            </IconButton>
            <IconButton
              size="1"
              variant="soft"
              color="gray"
              onClick={() => {
                setEditing(false);
                setDraft(credential.userLabel);
              }}
            >
              <PiX size={14} />
            </IconButton>
          </Flex>
        ) : (
          <Flex align="center" gap="2">
            <Text size="2" weight="medium" truncate>
              {credential.userLabel || "Unnamed passkey"}
            </Text>
            <Tooltip content="Rename">
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => setEditing(true)}
              >
                <PiPencilSimple size={12} />
              </IconButton>
            </Tooltip>
          </Flex>
        )}
        <Text size="1" color="gray">
          Added {formatDate(credential.createdDate)}
        </Text>
      </Flex>

      <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <Tooltip content="Remove passkey">
          <IconButton
            size="1"
            variant="ghost"
            color="red"
            disabled={deleting}
            onClick={() => setConfirmDelete(true)}
          >
            <PiTrash size={16} />
          </IconButton>
        </Tooltip>
        <AlertDialog.Content maxWidth="420px">
          <AlertDialog.Title>Remove passkey?</AlertDialog.Title>
          <AlertDialog.Description size="2">
            This passkey will be removed from your account. You won&apos;t be able to
            use it to sign in anymore.
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="red"
                onClick={() => {
                  onDelete(credential.id);
                  setConfirmDelete(false);
                }}
              >
                Remove
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
}

export function SecuritySettings() {
  const [credentials, setCredentials] = useState<KeycloakCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const loadCredentials = useCallback(async () => {
    try {
      const all = await fetchCredentials();
      setCredentials(all.filter((c) => c.type === PASSKEY_TYPE));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load credentials";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCredentials();
  }, [loadCredentials]);

  const handleAdd = useCallback(async () => {
    setAdding(true);
    try {
      await startPasskeySetup();
      await loadCredentials();
      toast.success("Passkey added");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Passkey setup failed";
      toast.error(msg);
    } finally {
      setAdding(false);
    }
  }, [loadCredentials]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await deleteCredential(id);
        setCredentials((prev) => prev.filter((c) => c.id !== id));
        toast.success("Passkey removed");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to remove passkey";
        toast.error(msg);
      } finally {
        setDeletingId(null);
      }
    },
    [],
  );

  const handleRename = useCallback(
    async (id: string, label: string) => {
      try {
        await updateCredentialLabel(id, label);
        setCredentials((prev) =>
          prev.map((c) => (c.id === id ? { ...c, userLabel: label } : c)),
        );
        toast.success("Passkey renamed");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to rename passkey";
        toast.error(msg);
      }
    },
    [],
  );

  return (
    <SettingsContainer>
      <Heading as="h2" size="4">
        Security
      </Heading>

      <Flex direction="column" gap="3">
        <Flex align="center" justify="between">
          <Flex direction="column" gap="1">
            <Text weight="medium" size="2">
              Passkeys
            </Text>
            <Text size="1" color="gray">
              Passkeys let you sign in without a password using your fingerprint,
              face, or device PIN.
            </Text>
          </Flex>
          <Badge variant="soft" size="1">
            {credentials.length}
          </Badge>
        </Flex>

        {loading && (
          <Flex align="center" justify="center" py="6">
            <Spinner size="3" />
          </Flex>
        )}

        {error && (
          <Flex direction="column" align="center" gap="2" py="4">
            <Text size="2" color="red">
              {error}
            </Text>
            <Button variant="soft" size="1" onClick={loadCredentials}>
              Retry
            </Button>
          </Flex>
        )}

        {!loading && !error && credentials.length === 0 && (
          <Flex
            direction="column"
            align="center"
            gap="2"
            py="6"
            style={{
              borderRadius: "var(--radius-2)",
              border: "1px dashed var(--gray-a6)",
            }}
          >
            <PiKey size={32} style={{ color: "var(--gray-a8)" }} />
            <Text size="2" color="gray">
              No passkeys registered yet
            </Text>
          </Flex>
        )}

        {!loading &&
          !error &&
          credentials.map((cred) => (
            <PasskeyRow
              key={cred.id}
              credential={cred}
              onDelete={handleDelete}
              onRename={handleRename}
              deleting={deletingId === cred.id}
            />
          ))}

        <Button
          variant="soft"
          onClick={handleAdd}
          disabled={adding}
          style={{ alignSelf: "flex-start" }}
        >
          <PiPlus size={16} />
          {adding ? "Redirecting..." : "Add passkey"}
        </Button>
      </Flex>
    </SettingsContainer>
  );
}
