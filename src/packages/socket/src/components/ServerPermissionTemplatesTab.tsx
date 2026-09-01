import { Button, IconButton, Surface, TextField } from "@gryt/ui";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { PiPlusBold, PiTrashBold } from "react-icons/pi";
import type { Socket } from "socket.io-client";

import type { ChannelRule } from "@/settings/src/channelPermissionRules";

import { useSocketEvent } from "../hooks/useSocketEvent";
import { ChannelPermissionMatrix } from "./ChannelPermissionMatrix";

/**
 * Permission templates: the answer several channels share.
 *
 * A channel can hold its own rules, and for one channel that is fine. The
 * moment there are four that were meant to match, per-channel rules drift —
 * somebody edits one, forgets the others, and six months later nobody can say
 * which of the four is right. That is the failure this screen exists to
 * prevent, which is why the count of channels using a template is on the row
 * rather than hidden: it is the difference between an edit that changes one
 * thing and an edit that changes nine.
 *
 * Needs `manage_roles` rather than `manage_channels`. A template is server-wide
 * policy; choosing one for a channel is the channel-level act, and the server
 * gates the two events that way.
 */

interface Template {
  id: string;
  name: string | null;
  isSystem: boolean;
  channelCount: number;
  rules: ChannelRule[];
}

interface TemplatesPayload {
  permissions?: string[];
  templates?: Template[];
}

interface RolesPayload {
  roles?: { id: string; name: string; rank: number; permissions: string[] }[];
}

/** Marks a template that has not been saved yet, so it has no server id. */
const NEW_TEMPLATE = "__new__";

export function ServerPermissionTemplatesTab({
  socket,
  accessToken,
}: {
  host: string;
  socket?: Socket;
  accessToken: string | null;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roles, setRoles] = useState<{ id: string; name: string; rank: number; permissions: string[] }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftRules, setDraftRules] = useState<ChannelRule[]>([]);
  const [saving, setSaving] = useState(false);

  const refresh = () => {
    if (!socket?.connected || !accessToken) return;
    socket.emit("server:permissions:templates:list", { accessToken });
    // The matrix needs the roles and what each already holds, so an inheriting
    // cell can show what it is inheriting. The role editor is the only other
    // place that asks, and both need `manage_roles` anyway.
    socket.emit("server:roles:definitions:list", { accessToken });
  };

  useSocketEvent<TemplatesPayload>(socket, "server:permissions:templates", (payload) => {
    if (!payload?.templates) return;
    setTemplates(payload.templates);
    if (payload.permissions?.length) setPermissions(payload.permissions);
    setSaving(false);

    // Somebody else saving while this is open replaces what is here rather
    // than merging into it, the same way the role editor behaves. Merging two
    // people's matrices would produce a policy neither of them chose.
    setSelectedId((current) => {
      if (current === NEW_TEMPLATE) return current;
      const still = payload.templates?.find((t) => t.id === current);
      if (!still) return null;
      setDraftName(still.name ?? "");
      setDraftRules(still.rules);
      return current;
    });
  });

  useSocketEvent<RolesPayload>(socket, "server:roles:definitions", (payload) => {
    if (payload?.roles) setRoles(payload.roles);
  });

  // useEffect, not useMemo. Emitting is a side effect, and doing it during
  // render fires it twice under StrictMode and at times React does not promise.
  useEffect(refresh, [socket, accessToken]);

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const isNew = selectedId === NEW_TEMPLATE;

  const select = (template: Template) => {
    setSelectedId(template.id);
    setDraftName(template.name ?? "");
    setDraftRules(template.rules);
  };

  const startNew = () => {
    setSelectedId(NEW_TEMPLATE);
    setDraftName("");
    setDraftRules([]);
  };

  const save = () => {
    if (!socket?.connected || !accessToken) return toast.error("Not connected to the server yet.");
    const name = draftName.trim();
    if (!name) return toast.error("Give the template a name first.");

    setSaving(true);
    socket.emit("server:permissions:template:save", {
      accessToken,
      // Absent for a new one, so the server mints the id. Sending NEW_TEMPLATE
      // would create a template literally called __new__ and then reuse it for
      // the next one.
      templateId: isNew ? undefined : selectedId,
      name,
      // The whole matrix, not a patch. A cell put back to inherit is a rule
      // absent from this list, and the server deletes what is not sent —
      // patching would leave inherit unreachable once anything else was set.
      rules: draftRules,
    });
    setTimeout(refresh, 400);
  };

  const remove = (template: Template) => {
    if (!socket?.connected || !accessToken) return;
    socket.emit("server:permissions:template:delete", { accessToken, templateId: template.id });
    if (selectedId === template.id) setSelectedId(null);
    setTimeout(refresh, 400);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Permission templates</span>
          <span className="text-xs">
            A named set of channel permissions. Change it here and every channel using it changes with it.
          </span>
        </div>
        <IconButton size="small" onClick={startNew} aria-label="New template">
          <PiPlusBold size={14} />
        </IconButton>
      </div>

      {templates.length === 0 && !isNew && (
        <span className="text-xs">
          No templates yet. Channels can still have their own permissions — a template is for when
          several of them should match.
        </span>
      )}

      <div className="flex flex-col gap-1">
        {templates.map((template) => (
          <Surface
            key={template.id}
            className={`flex items-center justify-between gap-2 p-2 ${
              selectedId === template.id ? "ring-1" : ""
            }`}
          >
            <button
              type="button"
              className="flex flex-1 flex-col items-start text-left"
              onClick={() => select(template)}
            >
              <span className="text-sm">{template.name}</span>
              <span className="text-xs">
                {/* The number that decides whether an edit here is small or
                    frightening, so it sits on the row rather than behind a
                    click. */}
                {template.channelCount === 0
                  ? "Not used by any channel yet"
                  : `Used by ${template.channelCount} channel${template.channelCount === 1 ? "" : "s"}`}
              </span>
            </button>
            {!template.isSystem && (
              <IconButton
                size="xsmall"
                aria-label={`Delete ${template.name}`}
                onClick={() => remove(template)}
              >
                <PiTrashBold size={13} />
              </IconButton>
            )}
          </Surface>
        ))}
      </div>

      {(selected || isNew) && (
        <Surface className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Name</span>
            <TextField
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Owners only"
            />
          </div>

          <ChannelPermissionMatrix
            roles={roles}
            permissions={permissions}
            rules={draftRules}
            disabled={saving}
            onChange={setDraftRules}
          />

          {/* Said before the save, not after. By the time it lands, anybody in
              a voice room they can no longer see has already been removed. */}
          {selected && selected.channelCount > 0 && (
            <span className="text-xs">
              Saving changes {selected.channelCount} channel
              {selected.channelCount === 1 ? "" : "s"}. Anyone who loses access to one will be
              removed from its voice room.
            </span>
          )}

          <div className="flex gap-2">
            <Button size="small" disabled={saving} onClick={save}>
              {saving ? "Saving…" : isNew ? "Create template" : "Save template"}
            </Button>
            <Button size="small" onClick={() => setSelectedId(null)}>
              Cancel
            </Button>
          </div>
        </Surface>
      )}
    </div>
  );
}
