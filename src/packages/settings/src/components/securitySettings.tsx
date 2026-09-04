import { AlertDialog, Button, Chip, IconButton, Spinner, TextField, Tooltip } from "@gryt/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

import type { KeycloakCredential } from "@/common";
import {
  deleteCredential,
  fetchCredentials,
  startPasskeySetup,
  updateCredentialLabel,
  useAccount,
} from "@/common";

import { PiCheck, PiKeyFill, PiPencilSimpleFill, PiPlus, PiTrashFill, PiX } from "../../../../lib/icons";
import { LocalIdentitySection } from "./localIdentitySection";
import { MessageKeySection } from "./messageKeySection";
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
    <div className="flex items-center gap-3 py-3 px-3" style={{
        borderRadius: "var(--gryt-radius-sm)",
        background: "var(--gryt-neutral-a2)",
      }}>
      <div className="flex items-center justify-center" style={{
          width: 36,
          height: 36,
          borderRadius: "var(--gryt-radius-sm)",
          background: "var(--gryt-accent-a3)",
          flexShrink: 0,
        }}>
        <PiKeyFill size={18} style={{ color: "var(--gryt-accent-11)" }} />
      </div>

      <div className="flex flex-col gap-1" style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div className="flex items-center gap-1">
            <TextField
              ref={inputRef} size="small"
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
            <IconButton size="xsmall" onClick={handleSave} disabled={saving}>
              <PiCheck size={14} />
            </IconButton>
            <IconButton size="xsmall"
              onClick={() => {
                setEditing(false);
                setDraft(credential.userLabel);
              }}
            >
              <PiX size={14} />
            </IconButton>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">
              {credential.userLabel || "Unnamed passkey"}
            </span>
            <Tooltip title="Rename">
              <IconButton tone="ghost" size="xsmall"
                onClick={() => setEditing(true)}
              >
                <PiPencilSimpleFill size={12} />
              </IconButton>
            </Tooltip>
          </div>
        )}
        <span className="text-xs">
          Added {formatDate(credential.createdDate)}
        </span>
      </div>

      <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <Tooltip title="Remove passkey">
          <IconButton tone="ghost" size="xsmall"
            disabled={deleting}
            onClick={() => setConfirmDelete(true)}
          >
            <PiTrashFill size={16} />
          </IconButton>
        </Tooltip>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop />
          <AlertDialog.Popup>
          <AlertDialog.Title>Remove passkey?</AlertDialog.Title>
          <AlertDialog.Description>
            This passkey will be removed from your account. You won&apos;t be able to
            use it to sign in anymore.
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
                <Button size="small"
                  onClick={() => {
                    onDelete(credential.id);
                    setConfirmDelete(false);
                  }}
                >
                  Remove
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

export function SecuritySettings() {
  const { isSignedIn } = useAccount();
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
    // Passkeys are a Keycloak credential, so without an account there is
    // nothing to fetch and the request fails. Somebody using Gryt without one
    // was being shown a section that could only ever say "Retry".
    if (!isSignedIn) {
      setLoading(false);
      return;
    }
    loadCredentials();
  }, [isSignedIn, loadCredentials]);

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
      <h2 className="text-lg">
        Security
      </h2>

      {!isSignedIn && <LocalIdentitySection />}

      {!isSignedIn ? null : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <span className="font-medium text-sm">Account identity</span>
            <span className="text-xs text-gryt-muted">
              Signing in on another device brings your account and your servers
              with you. Your messages are a separate key, and they need the
              message password below.
            </span>
          </div>

          <MessageKeySection />

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <span className="font-medium text-sm">Passkeys</span>
                <span className="text-xs">
                  Passkeys let you sign in without a password using your
                  fingerprint, face, or device PIN.
                </span>
              </div>
              <Chip tone="neutral">{credentials.length}</Chip>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-8">
                <Spinner size={24} />
              </div>
            )}

            {error && (
              <div className="flex flex-col items-center gap-2 py-4">
                <span className="text-sm">{error}</span>
                <Button size="xsmall" onClick={loadCredentials}>
                  Retry
                </Button>
              </div>
            )}

            {!loading && !error && credentials.length === 0 && (
              <div
                className="flex flex-col items-center gap-2 py-8"
                style={{
                  borderRadius: "var(--gryt-radius-sm)",
                  border: "1px dashed var(--gryt-neutral-a6)",
                }}
              >
                <PiKeyFill
                  size={32}
                  style={{ color: "var(--gryt-neutral-a8)" }}
                />
                <span className="text-sm">No passkeys registered yet</span>
              </div>
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
              size="small"
              onClick={handleAdd}
              disabled={adding}
              style={{ alignSelf: "flex-start" }}
            >
              <PiPlus size={16} />
              {adding ? "Redirecting..." : "Add passkey"}
            </Button>
          </div>
        </div>
      )}
    </SettingsContainer>
  );
}
