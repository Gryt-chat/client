import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

import { getServerAccessToken } from "@/common";
import {
  type ChannelRule,
  EVERYONE_VALUE,
  scopeChoiceFromValue,
  scopeChoiceValue,
  scopeOptions,
  scopeSetPayload,
} from "@/settings/src/channelPermissionRules";
import { Channel, serverDetailsList as ServerDetailsList,SidebarItem, SidebarReorderEntry } from "@/settings/src/types/server";

interface UseSidebarEditorParams {
  currentlyViewingServer: { host: string; name: string } | null;
  currentConnection: Socket | null;
  accessToken: string | null;
  serverDetailsList: ServerDetailsList;
}

export function useSidebarEditor({
  currentlyViewingServer,
  currentConnection,
  accessToken: _accessTokenProp,
  serverDetailsList,
}: UseSidebarEditorParams) {
  const getFreshAccessToken = () =>
    currentlyViewingServer ? getServerAccessToken(currentlyViewingServer.host) : _accessTokenProp;
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedSidebarItemId, setSelectedSidebarItemId] = useState<string | null>(null);

  const [sheetChannelName, setSheetChannelName] = useState("");
  const [sheetChannelIsVoice, setSheetChannelIsVoice] = useState(false);
  const [sheetRequirePtt, setSheetRequirePtt] = useState(false);
  const [sheetDisableRnnoise, setSheetDisableRnnoise] = useState(false);
  const [sheetMaxBitrate, setSheetMaxBitrate] = useState("");
  const [sheetEsportsMode, setSheetEsportsMode] = useState(false);
  const [sheetTextInVoice, setSheetTextInVoice] = useState(false);
  // Which scope the channel is on: "everyone", a template id, or "custom".
  const [sheetScopeChoice, setSheetScopeChoice] = useState(EVERYONE_VALUE);
  // The matrix, only meaningful while the choice is "custom". Kept while the
  // dropdown is on a template so switching back does not lose what was drawn.
  const [sheetScopeRules, setSheetScopeRules] = useState<ChannelRule[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  /*
   * What this channel could be pointed at, by name.
   *
   * Off `server:channels:scope`, which needs the same `manage_channels` as
   * opening this dialog. It used to come from `server:permissions:templates`,
   * which needs `manage_roles` — so a moderator who may arrange channels and
   * not set policy had the list refused and was offered Everyone and Custom
   * with no way to learn that any template existed.
   *
   * Names and ids only. What a template decides is still `manage_roles`.
   */
  const [permissionTemplates, setPermissionTemplates] = useState<
    { id: string; name: string | null; isSystem: boolean }[]
  >([]);
  const [channelPermissions, setChannelPermissions] = useState<string[]>([]);
  const [sheetSpacerHeight, setSheetSpacerHeight] = useState("16");
  const [sheetSeparatorLabel, setSheetSeparatorLabel] = useState("");

  const effectiveSidebarItems: SidebarItem[] = useMemo(() => {
    if (!currentlyViewingServer) return [];
    const details = serverDetailsList[currentlyViewingServer.host];
    const items = details?.sidebar_items;
    if (Array.isArray(items) && items.length > 0) return items;
    const chans = details?.channels || [];
    return chans.map((c: Channel, idx: number) => ({
      id: c.id,
      kind: "channel" as const,
      channelId: c.id,
      position: (idx + 1) * 10,
    }));
  }, [currentlyViewingServer, serverDetailsList]);

  const selectedSidebarItem = useMemo(() => {
    if (!selectedSidebarItemId) return null;
    return effectiveSidebarItems.find((it) => it.id === selectedSidebarItemId) || null;
  }, [effectiveSidebarItems, selectedSidebarItemId]);

  useEffect(() => {
    if (!selectedSidebarItemId) return;
    if (selectedSidebarItem) return;
    setSelectedSidebarItemId(null);
  }, [selectedSidebarItem, selectedSidebarItemId]);

  const channelById = useMemo(() => {
    if (!currentlyViewingServer) return new Map<string, Channel>();
    const chans = serverDetailsList[currentlyViewingServer.host]?.channels || [];
    return new Map(chans.map((c: Channel) => [c.id, c]));
  }, [currentlyViewingServer, serverDetailsList]);

  useEffect(() => {
    if (!selectedSidebarItem) return;
    if (selectedSidebarItem.kind === "channel") {
      const channelId = selectedSidebarItem.channelId ?? selectedSidebarItem.id;
      const ch = channelById.get(channelId);
      setSheetChannelName(ch?.name || "");
      setSheetChannelIsVoice((ch?.type || "text") === "voice");
      setSheetRequirePtt(ch?.requirePushToTalk || false);
      setSheetDisableRnnoise(ch?.disableRnnoise || false);
      setSheetMaxBitrate(ch?.maxBitrate ? String(ch.maxBitrate) : "");
      setSheetEsportsMode(ch?.eSportsMode || false);
      setSheetTextInVoice(ch?.textInVoice || false);
      // The scope and its rules are not reset here. See the effect below.
    } else if (selectedSidebarItem.kind === "spacer") {
      setSheetSpacerHeight(String(selectedSidebarItem.spacerHeight ?? 16));
    } else if (selectedSidebarItem.kind === "separator" || selectedSidebarItem.kind === "folder") {
      setSheetSeparatorLabel(String(selectedSidebarItem.label ?? ""));
    }
  }, [channelById, selectedSidebarItem]);

  /**
   * The choices for the visibility gate, as "everyone" plus one per role.
   *
   * The stored value is a rank, not a role id, so several roles at the same
   * rank collapse into one choice — picking either would store the same number.
   * Showing both would offer a distinction the gate cannot keep.
   *
   * Sorted low to high, the direction somebody narrowing a channel is thinking.
   */
  const scopeChoiceOptions = useMemo(
    () => scopeOptions(permissionTemplates.map((t) => ({ id: t.id, name: t.name }))),
    [permissionTemplates],
  );

  /** Role id to name, for the sentence under the dropdown and the matrix rows. */
  const scopeRoles = useMemo(() => {
    if (!currentlyViewingServer) return [];
    return serverDetailsList[currentlyViewingServer.host]?.server_info?.roles ?? [];
  }, [currentlyViewingServer, serverDetailsList]);

  /**
   * Ask the server for the templates and for this channel's own rules.
   *
   * Neither answer rides along on `server:details`: being allowed to see a
   * channel is not the same as being allowed to read which roles cannot, and
   * putting the matrix in the payload every member receives would hand that out
   * to all of them.
   */
  // The item is read through a ref rather than depended on. `selectedSidebarItem`
  // is a fresh object whenever `serverDetailsList` changes identity, and this
  // effect emits on every run — so depending on it made each reply re-run the
  // effect, which emitted again. React caught that as "Maximum update depth
  // exceeded" the moment the dialog opened. The deps below are all primitives.
  const selectedItemRef = useRef(selectedSidebarItem);
  selectedItemRef.current = selectedSidebarItem;

  const editingChannelId =
    selectedSidebarItem?.kind === "channel"
      ? selectedSidebarItem.channelId ?? selectedSidebarItem.id
      : null;

  /*
   * Clear the scope when a different channel is opened, and only then.
   *
   * This used to sit in the effect below, which depends on
   * `selectedSidebarItem` — a fresh object every time `serverDetailsList`
   * changes identity. Saving a scope makes the server broadcast
   * `server:details`, so the save reset the dropdown to Everyone a moment after
   * setting it (GRYT-892). The channel id is a string, so it only changes when
   * the channel does.
   */
  useEffect(() => {
    setSheetScopeChoice(EVERYONE_VALUE);
    setSheetScopeRules([]);
  }, [editingChannelId]);

  useEffect(() => {
    if (!editDialogOpen) return;
    if (!editingChannelId) return;
    if (!currentlyViewingServer || !currentConnection?.connected) return;

    const accessToken = getFreshAccessToken();
    if (!accessToken) return;

    const channelId = editingChannelId;
    let cancelled = false;
    setScopeLoading(true);

    const onScope = (payload: {
      channelId?: string;
      scopeId?: string | null;
      isTemplate?: boolean;
      permissions?: string[];
      rules?: ChannelRule[];
      templates?: { id: string; name: string | null; isSystem: boolean }[];
    }) => {
      // The reply names the channel it is about. Without this check, opening
      // one channel and quickly opening another paints the first one's rules
      // into the second one's dialog — and then saves them.
      if (cancelled || payload?.channelId !== channelId) return;
      setSheetScopeChoice(scopeChoiceValue(payload.scopeId ?? null, Boolean(payload.isTemplate)));
      setSheetScopeRules(payload.rules ?? []);
      // Absent from a server too old to send it, which leaves the dropdown as
      // it was before: Everyone and Custom.
      setPermissionTemplates(payload.templates ?? []);
      if (payload.permissions?.length) setChannelPermissions(payload.permissions);
      setScopeLoading(false);
    };

    currentConnection.on("server:channels:scope", onScope);
    currentConnection.emit("server:channels:scope:get", { accessToken, channelId });

    return () => {
      cancelled = true;
      currentConnection.off("server:channels:scope", onScope);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDialogOpen, editingChannelId, currentlyViewingServer?.host, currentConnection]);

  /**
   * Send the channel's scope choice.
   *
   * Separate from `saveSelectedSidebarItem` on purpose. That one renames and
   * retunes the channel, and a rename must never be able to change who can see
   * it — the server refuses a scope on `server:channels:upsert` for the same
   * reason.
   */
  /*
   * `choice` and `rules` are arguments rather than only state because a caller
   * that changes one of them and saves in the same tick cannot wait for the
   * state to arrive. This function is held in a ref that is reassigned during
   * render, so an event handler runs the closure the *last* render built — with
   * the value the control had before it was changed. The dropdown did that, and
   * since the previous value is almost always `everyone`, every attempt to
   * restrict a channel sent "clear the scope" (GRYT-892).
   *
   * The debounced callers still pass nothing and read state, which is correct
   * for them: 600ms later the render has happened.
   */
  const saveChannelScope = useCallback((choice?: string, rules?: ChannelRule[]) => {
    const item = selectedItemRef.current;
    if (!currentlyViewingServer || item?.kind !== "channel") return;
    if (!currentConnection?.connected) return toast.error("Not connected to the server yet.");
    const accessToken = getFreshAccessToken();
    if (!accessToken) return toast.error("Join the server first.");

    const channelId = item.channelId ?? item.id;
    currentConnection.emit("server:channels:scope:set", {
      accessToken,
      channelId,
      ...scopeSetPayload(
        scopeChoiceFromValue(choice ?? sheetScopeChoice),
        rules ?? sheetScopeRules,
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentlyViewingServer, currentConnection, sheetScopeChoice, sheetScopeRules]);

  const closeEditDialog = useCallback(() => {
    setEditDialogOpen(false);
    setSelectedSidebarItemId(null);
  }, []);

  /**
   * `order` carries the folder each item belongs in as well as its place.
   *
   * One drag can do both, so they travel together. The server still accepts a
   * bare id per entry, meaning "leave the folder alone", which is what a client
   * from before folders sends.
   */
  const reorderSidebar = useCallback(
    (order: SidebarReorderEntry[]) => {
      if (!currentlyViewingServer) return;
      if (!currentConnection || !currentConnection.connected)
        return toast.error("Not connected to the server yet.");
      const accessToken = getFreshAccessToken();
      if (!accessToken) return toast.error("Join the server first.");
      currentConnection.emit("server:sidebar:reorder", { accessToken, order });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentlyViewingServer, currentConnection],
  );

  const insertFromPalette = useCallback(
    async (paletteKind: string, index: number) => {
      if (!currentlyViewingServer) return;
      if (!currentConnection || !currentConnection.connected)
        return toast.error("Not connected to the server yet.");
      const accessToken = getFreshAccessToken();
      if (!accessToken) return toast.error("Join the server first.");

      const getNextPosition = () => {
        const maxPos = Math.max(
          0,
          ...effectiveSidebarItems.map((i) =>
            typeof i.position === "number" ? i.position : 0,
          ),
        );
        return maxPos + 10;
      };

      const getInsertPosition = (idx: number) => {
        const prev = effectiveSidebarItems[idx - 1];
        const next = effectiveSidebarItems[idx];
        const prevPos =
          typeof prev?.position === "number" ? prev.position : idx * 10;
        const nextPos =
          typeof next?.position === "number" ? next.position : prevPos + 20;
        const gap = nextPos - prevPos;
        if (gap > 1) {
          const mid = Math.floor((prevPos + nextPos) / 2);
          if (mid > prevPos && mid < nextPos) return mid;
          return prevPos + 1;
        }
        return getNextPosition();
      };

      const pos = getInsertPosition(index);

      if (paletteKind === "separator") {
        const itemId = `sb_sep_${uuidv4().slice(0, 10)}`;
        currentConnection.emit("server:sidebar:item:upsert", {
          accessToken,
          itemId,
          kind: "separator",
          position: pos,
          label: null,
        });
        return;
      }

      /* Named on creation rather than left blank and edited after. A folder
         with no name draws as "Folder", which is a row nobody can tell from
         the next one, and the sidebar is where they would be telling them
         apart. */
      if (paletteKind === "folder") {
        const itemId = `sb_fold_${uuidv4().slice(0, 10)}`;
        currentConnection.emit("server:sidebar:item:upsert", {
          accessToken,
          itemId,
          kind: "folder",
          position: pos,
          label: "New folder",
        });
        return;
      }

      if (paletteKind === "spacer") {
        const itemId = `sb_sp_${uuidv4().slice(0, 10)}`;
        currentConnection.emit("server:sidebar:item:upsert", {
          accessToken,
          itemId,
          kind: "spacer",
          position: pos,
          spacerHeight: 16,
        });
        return;
      }

      if (paletteKind === "channel:text" || paletteKind === "channel:voice") {
        const type: "text" | "voice" =
          paletteKind === "channel:voice" ? "voice" : "text";
        const channelId = `chan_${uuidv4().slice(0, 10)}`;
        const itemId = `sb_${uuidv4().slice(0, 10)}`;
        currentConnection.emit("server:channels:upsert", {
          accessToken,
          channelId,
          name: type === "voice" ? "New voice channel" : "New channel",
          type,
          description: null,
        });
        currentConnection.emit("server:sidebar:item:upsert", {
          accessToken,
          itemId,
          kind: "channel",
          channelId,
          position: pos,
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentlyViewingServer, currentConnection, effectiveSidebarItems],
  );

  // Create a fully-configured channel in one confirmed step, instead of
  // dropping a default text channel that has to be edited after. GRYT-983.
  const createChannel = useCallback(
    async (opts: { name: string; type: "text" | "voice"; layout?: "chat" | "forum"; automated?: boolean; description?: string | null; forumTags?: { id: string; name: string; emoji?: string | null; color?: string | null }[] }) => {
      if (!currentlyViewingServer) return;
      if (!currentConnection || !currentConnection.connected) {
        toast.error("Not connected to the server yet.");
        return;
      }
      const accessToken = getFreshAccessToken();
      if (!accessToken) {
        toast.error("Join the server first.");
        return;
      }
      const maxPos = Math.max(
        0,
        ...effectiveSidebarItems.map((i) => (typeof i.position === "number" ? i.position : 0)),
      );
      const channelId = `chan_${uuidv4().slice(0, 10)}`;
      const itemId = `sb_${uuidv4().slice(0, 10)}`;
      currentConnection.emit("server:channels:upsert", {
        accessToken,
        channelId,
        name: opts.name.trim() || (opts.type === "voice" ? "New voice channel" : "New channel"),
        type: opts.type,
        description: opts.description ?? null,
        layout: opts.layout ?? "chat",
        automated: opts.automated ?? false,
        forumTags: opts.forumTags ?? [],
      });
      currentConnection.emit("server:sidebar:item:upsert", {
        accessToken,
        itemId,
        kind: "channel",
        channelId,
        position: maxPos + 10,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentlyViewingServer, currentConnection, effectiveSidebarItems],
  );

  const [pendingDeleteItem, setPendingDeleteItem] = useState<SidebarItem | null>(null);

  const requestDeleteSidebarItem = useCallback((item: SidebarItem) => {
    setPendingDeleteItem(item);
  }, []);

  const cancelDelete = useCallback(() => {
    setPendingDeleteItem(null);
  }, []);

  const confirmDelete = useCallback(() => {
    const item = pendingDeleteItem;
    if (!item) return;
    setPendingDeleteItem(null);

    if (!currentlyViewingServer) return;
    if (!currentConnection || !currentConnection.connected)
      return toast.error("Not connected to the server yet.");
    const accessToken = getFreshAccessToken();
    if (!accessToken) return toast.error("Join the server first.");

    if (selectedSidebarItemId === item.id) {
      setSelectedSidebarItemId(null);
    }

    if (item.kind === "channel") {
      const channelId = item.channelId ?? item.id;
      currentConnection.emit("server:sidebar:item:delete", {
        accessToken,
        itemId: item.id,
      });
      currentConnection.emit("server:channels:delete", {
        accessToken,
        channelId,
      });
      return;
    }

    currentConnection.emit("server:sidebar:item:delete", {
      accessToken,
      itemId: item.id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDeleteItem, currentlyViewingServer, currentConnection, selectedSidebarItemId]);

  const saveSelectedSidebarItem = useCallback(async () => {
    if (!currentlyViewingServer) return;
    if (!selectedSidebarItem) return;
    if (!currentConnection || !currentConnection.connected)
      return toast.error("Not connected to the server yet.");
    const accessToken = getFreshAccessToken();
    if (!accessToken) return toast.error("Join the server first.");

    if (selectedSidebarItem.kind === "channel") {
      const chId = selectedSidebarItem.channelId ?? selectedSidebarItem.id;
      const existing = channelById.get(chId);
      const nextName = sheetChannelName.trim().length
        ? sheetChannelName.trim()
        : (existing?.name || "Channel");
      const nextType: "text" | "voice" = sheetChannelIsVoice ? "voice" : "text";
      const parsedBitrate = parseInt(sheetMaxBitrate, 10);
      currentConnection.emit("server:channels:upsert", {
        accessToken,
        channelId: chId,
        name: nextName,
        type: nextType,
        description: null,
        requirePushToTalk: sheetRequirePtt,
        disableRnnoise: sheetEsportsMode || sheetDisableRnnoise,
        maxBitrate: !isNaN(parsedBitrate) && parsedBitrate > 0 ? parsedBitrate : null,
        eSportsMode: sheetEsportsMode,
        textInVoice: sheetTextInVoice,
        // Always sent, including as null. The server treats an *absent*
        // viewMinRank as "leave it alone", which is what stops an older client
        // reopening a hidden channel by saving an unrelated setting. This
        // client knows about the field, so leaving it out here would make
        // clearing a gate impossible.
      });
      return;
    }

    if (selectedSidebarItem.kind === "spacer") {
      const h = Math.max(
        0,
        Math.min(500, parseInt(sheetSpacerHeight || "0", 10) || 0),
      );
      currentConnection.emit("server:sidebar:item:upsert", {
        accessToken,
        itemId: selectedSidebarItem.id,
        kind: "spacer",
        position: selectedSidebarItem.position,
        spacerHeight: h,
      });
      return;
    }

    /* A folder is renamed through the same field a separator uses, because it
       is the same edit: both carry one piece of text and nothing else. The one
       difference is the empty case — a separator with no label is a plain rule,
       which is a reasonable thing to want, while a folder with no name is a row
       you cannot tell from the next one. So it keeps the name it had. */
    if (selectedSidebarItem.kind === "separator" || selectedSidebarItem.kind === "folder") {
      const typed = sheetSeparatorLabel.trim();
      const label = typed.length
        ? typed
        : selectedSidebarItem.kind === "folder"
          ? selectedSidebarItem.label ?? "New folder"
          : null;
      currentConnection.emit("server:sidebar:item:upsert", {
        accessToken,
        itemId: selectedSidebarItem.id,
        kind: selectedSidebarItem.kind,
        position: selectedSidebarItem.position,
        label,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentlyViewingServer,
    selectedSidebarItem,
    currentConnection,
    channelById,
    sheetChannelName,
    sheetChannelIsVoice,
    sheetRequirePtt,
    sheetDisableRnnoise,
    sheetMaxBitrate,
    sheetEsportsMode,
    sheetTextInVoice,
    sheetSpacerHeight,
    sheetSeparatorLabel,
  ]);

  return {
    editDialogOpen,
    setEditDialogOpen,
    selectedSidebarItemId,
    setSelectedSidebarItemId,
    selectedSidebarItem,
    effectiveSidebarItems,
    sheetChannelName,
    setSheetChannelName,
    sheetChannelIsVoice,
    setSheetChannelIsVoice,
    sheetRequirePtt,
    setSheetRequirePtt,
    sheetDisableRnnoise,
    setSheetDisableRnnoise,
    sheetMaxBitrate,
    setSheetMaxBitrate,
    sheetEsportsMode,
    setSheetEsportsMode,
    sheetTextInVoice,
    setSheetTextInVoice,
    sheetScopeChoice,
    setSheetScopeChoice,
    sheetScopeRules,
    setSheetScopeRules,
    scopeChoiceOptions,
    scopeRoles,
    channelPermissions,
    permissionTemplates,
    scopeLoading,
    saveChannelScope,
    sheetSpacerHeight,
    setSheetSpacerHeight,
    sheetSeparatorLabel,
    setSheetSeparatorLabel,
    closeEditDialog,
    reorderSidebar,
    insertFromPalette,
    createChannel,
    pendingDeleteItem,
    requestDeleteSidebarItem,
    cancelDelete,
    confirmDelete,
    saveSelectedSidebarItem,
  };
}
