import { useEffect, useMemo, useState } from "react";
import { Socket } from "socket.io-client";

import type { MemberInfo } from "../components/MemberSidebar";

interface UseServerReportsParams {
  currentConnection: Socket | null;
  accessToken: string | null;
  currentlyViewingServer: { host: string } | null;
  memberLists: Record<string, MemberInfo[] | undefined>;
  /**
   * Whether this member may *read* the reports queue. `view_reports`, not
   * `manage_reports`, and `has(...)` not `can(...)` (GRYT-844, GRYT-874).
   */
  canViewReports: boolean;
}

export function useServerReports({
  currentConnection, accessToken, currentlyViewingServer, memberLists, canViewReports,
}: UseServerReportsParams) {
  const [reportsOpen, setReportsOpen] = useState(false);
  const [pendingReportCount, setPendingReportCount] = useState(0);

  useEffect(() => {
    if (!currentConnection) return;
    /* Both halves of the queue in one number: the badge answers "is there
       anything waiting". `userReports` is absent on an older server. */
    const onReportsList = (payload: {
      reports: Array<unknown>;
      userReports?: Array<unknown>;
    }) => {
      setPendingReportCount((payload.reports?.length ?? 0) + (payload.userReports?.length ?? 0));
    };
    currentConnection.on("reports:list", onReportsList);
    if (canViewReports && accessToken) {
      currentConnection.emit("reports:list", { accessToken });
    }
    return () => { currentConnection.off("reports:list", onReportsList); };
  }, [currentConnection, canViewReports, accessToken]);

  /**
   * The member list, keyed by server user id, whole. Copying out three fields is
   * why none of GRYT-159's identity detail ever reached chat.
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
