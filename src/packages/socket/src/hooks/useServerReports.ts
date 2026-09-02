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
    /* Both halves of the queue in one number. The badge answers "is there
       anything waiting", and splitting it would mean two badges on one
       button. `userReports` is absent on a server that predates them. */
    const onReportsList = (payload: {
      reports: Array<unknown>;
      userReports?: Array<unknown>;
    }) => {
      setPendingReportCount((payload.reports?.length ?? 0) + (payload.userReports?.length ?? 0));
    };
    currentConnection.on("reports:list", onReportsList);
    if (isAdmin && accessToken) {
      currentConnection.emit("reports:list", { accessToken });
    }
    return () => { currentConnection.off("reports:list", onReportsList); };
  }, [currentConnection, isAdmin, accessToken]);

  /**
   * The member list, keyed by server user id, whole.
   *
   * This used to copy out three fields — nickname, serverUserId, avatarFileId —
   * which is why none of GRYT-159's identity detail ever reached chat: it was
   * dropped here, one layer above the components that needed it. Passing the
   * member through costs nothing; it is the same objects, in a map.
   */
  const memberListMap = useMemo(() => {
    const members = currentlyViewingServer ? memberLists[currentlyViewingServer.host] : undefined;
    if (!members) return {};
    const map: Record<string, MemberInfo> = {};
    for (const member of members) {
      map[member.serverUserId] = member;
    }
    return map;
  }, [currentlyViewingServer, memberLists]);

  return { reportsOpen, setReportsOpen, pendingReportCount, memberListMap };
}
