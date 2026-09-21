import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

import { getServerAccessToken, type NotificationLevel } from "@/common";
import {
  type ChannelRule,
  EVERYONE_VALUE,
  scopeChoiceFromValue,
  scopeChoiceValue,
  scopeOptions,
  scopeSetPayload,
} from "@/settings/src/channelPermissionRules";
import { Channel, serverDetailsList as ServerDetailsList,SidebarItem, SidebarReorderEntry } from "@/settings/src/types/server";

import { type ChannelKind, fieldsToKind, kindToFields } from "../components/channelKind";
import type { ForumTagDraft } from "../components/ForumTagsField";
import { type ChannelPlacement, orderBelow, placeNewChannel } from "../components/sidebarTree";

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
  const [sheetChannelKind, setSheetChannelKind] = useState<ChannelKind>("chat");
  const [sheetForumTags, setSheetForumTags] = useState<ForumTagDraft[]>([]);
  const [sheetRequirePtt, setSheetRequirePtt] = useState(false);
  const [sheetDisableRnnoise, setSheetDisableRnnoise] = useState(false);
  const [sheetMaxBitrate, setSheetMaxBitrate] = useState("");
  const [sheetEsportsMode, setSheetEsportsMode] = useState(false);
  const [sheetTextInVoice, setSheetTextInVoice] = useState(false);
  const [sheetDefaultNotificationLevel, setSheetDefaultNotificationLevel] = useState<NotificationLevel>("all");
  // Which scope the channel is on: "everyone", a template id, or "custom".
  const [sheetScopeChoice, setSheetScopeChoice] = useState(EVERYONE_VALUE);
  // The matrix, only meaningful while the choice is "custom". Kept while the
  // dropdown is on a template so switching back does not lose what was drawn.
  const [sheetScopeRules, setSheetScopeRules] = useState<ChannelRule[]>([]);
  const [scopeLoading, setScopeLoading] = useState(false);
  // The folder a channel sits in, and whether it takes that folder's scope.
  const [sheetScopeFolder, setSheetScopeFolder] = useState<{ id: string; name: string | null } | null>(null);
  const [sheetScopeFollowsFolder, setSheetScopeFollowsFolder] = useState(false);
  /*
   * What this channel could be pointed at, by name. Off `server:channels:scope`,
   * which needs the same `manage_channels` as opening this dialog.
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
      setSheetChannelKind(fieldsToKind({ type: ch?.type, layout: ch?.layout, automated: ch?.automated }));
      setSheetForumTags((ch?.forumTags ?? []).map((t) => ({ id: t.id, name: t.name, emoji: t.emoji ?? null, color: t.color ?? null })));
      setSheetRequirePtt(ch?.requirePushToTalk || false);
      setSheetDisableRnnoise(ch?.disableRnnoise || false);
      setSheetMaxBitrate(ch?.maxBitrate ? String(ch.maxBitrate) : "");
      setSheetEsportsMode(ch?.eSportsMode || false);
      setSheetTextInVoice(ch?.textInVoice || false);
      // An older server sends no level; automated is quiet by default there too.
      setSheetDefaultNotificationLevel(ch?.defaultNotificationLevel ?? (ch?.automated ? "none" : "all"));
      // The scope and its rules are not reset here. See the effect below.
    } else if (selectedSidebarItem.kind === "spacer") {
      setSheetSpacerHeight(String(selectedSidebarItem.spacerHeight ?? 16));
    } else if (selectedSidebarItem.kind === "separator" || selectedSidebarItem.kind === "folder") {
      setSheetSeparatorLabel(String(selectedSidebarItem.label ?? ""));
    }
  }, [channelById, selectedSidebarItem]);

  /**
   * The choices for the visibility gate. The stored value is a rank, not a role id,
   * so roles at the same rank collapse into one choice. Sorted low to high.
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
   * Ask the server for the templates and for this channel's own rules. Neither
   * rides on `server:details`: that payload goes to every member.
   */

  // The item is read through a ref rather than depended on: `selectedSidebarItem`
  // is a fresh object per render and this effect emits, so depending on it looped.
  const selectedItemRef = useRef(selectedSidebarItem);
  selectedItemRef.current = selectedSidebarItem;

  const editingChannelId =
    selectedSidebarItem?.kind === "channel"
      ? selectedSidebarItem.channelId ?? selectedSidebarItem.id
      : null;

  /** A server says whether folders carry a scope; an older one ignores the events. */
  const folderPermissions = Boolean(
    currentlyViewingServer && serverDetailsList[currentlyViewingServer.host]?.server_info?.folder_permissions,
  );
  const editingFolderId =
    selectedSidebarItem?.kind === "folder" && folderPermissions ? selectedSidebarItem.id : null;

  /*
   * Clear the scope when a different item is opened, and only then. In the
   * effect below it reset the dropdown a moment after a save (GRYT-892).
   */
  useEffect(() => {
    setSheetScopeChoice(EVERYONE_VALUE);
    setSheetScopeRules([]);
    setSheetScopeFolder(null);
    setSheetScopeFollowsFolder(false);
  }, [editingChannelId, editingFolderId]);

  useEffect(() => {
    if (!editDialogOpen) return;
    const target = editingChannelId
      ? { kind: "channel" as const, id: editingChannelId }
      : editingFolderId
        ? { kind: "folder" as const, id: editingFolderId }
        : null;
    if (!target) return;
    if (!currentlyViewingServer || !currentConnection?.connected) return;

    const accessToken = getFreshAccessToken();
    if (!accessToken) return;

    let cancelled = false;
    setScopeLoading(true);

    const onScope = (payload: {
      channelId?: string;
      folderId?: string;
      scopeId?: string | null;
      isTemplate?: boolean;
      permissions?: string[];
      rules?: ChannelRule[];
      templates?: { id: string; name: string | null; isSystem: boolean }[];
      followsFolder?: boolean;
      folder?: { id: string; name: string | null } | null;
    }) => {
      // The reply names the item it is about. Without this, opening one channel
      // and quickly opening another paints the first one's rules into the second.
      const about = target.kind === "channel" ? payload?.channelId : payload?.folderId;
      if (cancelled || about !== target.id) return;
      setSheetScopeChoice(scopeChoiceValue(payload.scopeId ?? null, Boolean(payload.isTemplate)));
      setSheetScopeRules(payload.rules ?? []);
      // Absent from a server too old to send it, which leaves the dropdown as
      // it was before: Everyone and Custom.
      setPermissionTemplates(payload.templates ?? []);
      if (payload.permissions?.length) setChannelPermissions(payload.permissions);
      setSheetScopeFolder(payload.folder ?? null);
      setSheetScopeFollowsFolder(Boolean(payload.followsFolder));
      setScopeLoading(false);
    };

    const reply = target.kind === "channel" ? "server:channels:scope" : "server:folders:scope";
    currentConnection.on(reply, onScope);
    if (target.kind === "channel") {
      currentConnection.emit("server:channels:scope:get", { accessToken, channelId: target.id });
    } else {
      currentConnection.emit("server:folders:scope:get", { accessToken, folderId: target.id });
    }

    return () => {
      cancelled = true;
      currentConnection.off(reply, onScope);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDialogOpen, editingChannelId, editingFolderId, currentlyViewingServer?.host, currentConnection]);

  /**
   * Send the channel's or folder's scope choice. Separate from `saveSelectedSidebarItem`:
   * a rename must never be able to change who can see anything.
   */

  /*
   * `choice` and `rules` are arguments, not state: this is held in a ref reassigned
   * during render, so a handler reads the value the control had before the change.
   */
  const saveScope = useCallback((choice?: string, rules?: ChannelRule[]) => {
    const item = selectedItemRef.current;
    if (!currentlyViewingServer || (item?.kind !== "channel" && item?.kind !== "folder")) return;
    if (!currentConnection?.connected) return toast.error("Not connected to the server yet.");
    const accessToken = getFreshAccessToken();
    if (!accessToken) return toast.error("Join the server first.");

    const payload = scopeSetPayload(scopeChoiceFromValue(choice ?? sheetScopeChoice), rules ?? sheetScopeRules);
    if (item.kind === "folder") {
      currentConnection.emit("server:folders:scope:set", { accessToken, folderId: item.id, ...payload });
      return;
    }
    currentConnection.emit("server:channels:scope:set", { accessToken, channelId: item.channelId ?? item.id, ...payload });
    // Anything picked for a channel is its own now, as the server records it.
    setSheetScopeFollowsFolder(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentlyViewingServer, currentConnection, sheetScopeChoice, sheetScopeRules]);

  /** Back to the folder's scope. The server answers with the channel's scope again,
      which the effect above picks up, so the dropdown shows the folder's choice. */
  const followFolder = useCallback(() => {
    const item = selectedItemRef.current;
    if (!currentlyViewingServer || item?.kind !== "channel") return;
    if (!currentConnection?.connected) return toast.error("Not connected to the server yet.");
    const accessToken = getFreshAccessToken();
    if (!accessToken) return toast.error("Join the server first.");
    currentConnection.emit("server:channels:scope:follow", { accessToken, channelId: item.channelId ?? item.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentlyViewingServer, currentConnection]);

  const closeEditDialog = useCallback(() => {
    setEditDialogOpen(false);
    setSelectedSidebarItemId(null);
  }, []);

  /**
   * `order` carries the folder each item belongs in as well as its place. A bare id
   * per entry still means "leave the folder alone", which older clients send.
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

      /* Named on creation rather than left blank. A folder with no name draws as
         "Folder", which is a row nobody can tell from the next one. */
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

  /* A row that had no room under its neighbour went in beside it. Once it shows up,
     a reorder moves it under; if that never happens it stays next to the neighbour. */
  const pendingBelowRef = useRef<{ host: string; itemId: string; afterItemId: string } | null>(null);

  useEffect(() => {
    const pending = pendingBelowRef.current;
    if (!pending || pending.host !== currentlyViewingServer?.host) return;
    if (!effectiveSidebarItems.some((i) => i.id === pending.itemId)) return;
    pendingBelowRef.current = null;
    const order = orderBelow(effectiveSidebarItems, pending.itemId, pending.afterItemId);
    if (order) reorderSidebar(order);
  }, [effectiveSidebarItems, currentlyViewingServer?.host, reorderSidebar]);

  // Create a fully-configured channel in one confirmed step, instead of
  // dropping a default text channel that has to be edited after. GRYT-983.
  const createChannel = useCallback(
    async (opts: { name: string; type: "text" | "voice"; layout?: "chat" | "forum"; automated?: boolean; description?: string | null; forumTags?: { id: string; name: string; emoji?: string | null; color?: string | null }[]; defaultNotificationLevel?: NotificationLevel; placement?: ChannelPlacement }) => {
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
      const spot = placeNewChannel(effectiveSidebarItems, opts.placement);
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
        defaultNotificationLevel: opts.defaultNotificationLevel ?? (opts.automated ? "none" : "all"),
        // On both, so a channel made in a folder is never drawn outside it first.
        parentItemId: spot.parentItemId,
      });
      currentConnection.emit("server:sidebar:item:upsert", {
        accessToken,
        itemId,
        kind: "channel",
        channelId,
        position: spot.position,
        parentItemId: spot.parentItemId,
      });
      if (spot.reorderBelow) {
        pendingBelowRef.current = { host: currentlyViewingServer.host, itemId, afterItemId: spot.reorderBelow };
      }
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
      const kindFields = kindToFields(sheetChannelKind);
      const nextType: "text" | "voice" = kindFields.type;
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
        layout: kindFields.layout,
        automated: kindFields.automated,
        forumTags: sheetForumTags,
        defaultNotificationLevel: sheetDefaultNotificationLevel,
        // Always sent, including as null. The server treats an *absent* viewMinRank
        // as "leave it alone", so leaving it out here cannot clear a gate.
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

    /* A folder is renamed through the same field a separator uses. The difference is
       the empty case: a nameless separator is a rule, a nameless folder is not. */
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
    sheetChannelKind,
    sheetForumTags,
    sheetRequirePtt,
    sheetDisableRnnoise,
    sheetMaxBitrate,
    sheetEsportsMode,
    sheetTextInVoice,
    sheetDefaultNotificationLevel,
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
    sheetChannelKind,
    setSheetChannelKind,
    sheetForumTags,
    setSheetForumTags,
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
    sheetDefaultNotificationLevel,
    setSheetDefaultNotificationLevel,
    sheetScopeChoice,
    setSheetScopeChoice,
    sheetScopeRules,
    setSheetScopeRules,
    scopeChoiceOptions,
    scopeRoles,
    channelPermissions,
    permissionTemplates,
    scopeLoading,
    saveScope,
    sheetScopeFolder,
    sheetScopeFollowsFolder,
    followFolder,
    folderPermissions,
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
