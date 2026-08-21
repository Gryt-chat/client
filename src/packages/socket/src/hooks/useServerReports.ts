import { useEffect, useMemo, useState } from "react";
import { Socket } from "socket.io-client";

import type { MemberInfo } from "../components/MemberSidebar";

interface UseServerReportsParams {
  currentConnection: Socket | null;
  accessToken: string | null;
  currentlyViewingServer: { host: string } | null;
  memberLists: Record<string, MemberInfo[] | undefined>;
  /**
   * Whether this member may work the reports queue.
   *
   * Was the role name, compared against owner-or-admin. The queue is gated on
   * `manage_reports` now, so a role built to do nothing but handle reports gets
   * the badge and the panel.
   */
  canHandleReports: boolean;
}

export function useServerReports({
  currentConnection, accessToken, currentlyViewingServer, memberLists, canHandleReports,
}: UseServerReportsParams) {
  const [reportsOpen, setReportsOpen] = useState(false);
  const [pendingReportCount, setPendingReportCount] = useState(0);
  const isAdmin = canHandleReports;

  useEffect(() => {
    if (!currentConnection) return;
    const onReportsList = (payload: { reports: Array<unknown> }) => {
      setPendingReportCount(payload.reports?.length ?? 0);
    };
    currentConnection.on("reports:list", onReportsList);
    if (isAdmin && accessToken) {
      currentConnection.emit("reports:list", { accessToken });
    }
    return () => { currentConnection.off("reports:list", onReportsList); };
  }, [currentConnection, isAdmin, accessToken]);

  const memberListMap = useMemo(() => {
    const members = currentlyViewingServer ? memberLists[currentlyViewingServer.host] : undefined;
    if (!members) return {};
    const map: Record<string, { nickname: string; serverUserId: string; avatarFileId?: string | null }> = {};
    for (const member of members) {
      map[member.serverUserId] = { nickname: member.nickname, serverUserId: member.serverUserId, avatarFileId: member.avatarFileId };
    }
    return map;
  }, [currentlyViewingServer, memberLists]);

  return { reportsOpen, setReportsOpen, pendingReportCount, memberListMap };
}
