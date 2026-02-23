import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

import { getServerAccessToken } from "@/common";
import { Channel, serverDetailsList as ServerDetailsList,SidebarItem } from "@/settings/src/types/server";

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
    } else if (selectedSidebarItem.kind === "spacer") {
      setSheetSpacerHeight(String(selectedSidebarItem.spacerHeight ?? 16));
    } else if (selectedSidebarItem.kind === "separator") {
      setSheetSeparatorLabel(String(selectedSidebarItem.label ?? ""));
    }
  }, [channelById, selectedSidebarItem]);

  const closeEditDialog = useCallback(() => {
    setEditDialogOpen(false);
    setSelectedSidebarItemId(null);
  }, []);

  const reorderSidebar = useCallback(
    (order: string[]) => {
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

    if (selectedSidebarItem.kind === "separator") {
      const label = sheetSeparatorLabel.trim().length
        ? sheetSeparatorLabel.trim()
        : null;
      currentConnection.emit("server:sidebar:item:upsert", {
        accessToken,
        itemId: selectedSidebarItem.id,
        kind: "separator",
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
    sheetSpacerHeight,
    setSheetSpacerHeight,
    sheetSeparatorLabel,
    setSheetSeparatorLabel,
    closeEditDialog,
    reorderSidebar,
    insertFromPalette,
    pendingDeleteItem,
    requestDeleteSidebarItem,
    cancelDelete,
    confirmDelete,
    saveSelectedSidebarItem,
  };
}
