import { useEffect, useMemo, useState } from "react";
import { Socket } from "socket.io-client";

import type { MemberInfo } from "../components/MemberSidebar";

interface UseServerReportsParams {
  currentConnection: Socket | null;
  accessToken: string | null;
  currentlyViewingServer: { host: string } | null;
  memberLists: Record<string, MemberInfo[] | undefined>;
  /**
   * Whether this member may *read* the reports queue.
   *
   * `view_reports`, not `manage_reports`. Those are two permissions and the
   * server gates `reports:list` on the first (`socket/handlers/reports.ts`,
   * asserted in `permissionGates.test.ts`). Asking on the second refused
   * members who could read and let members who could not act emit anyway,
   * which surfaced as an error toast naming an internal permission string
   * moments after joining. GRYT-844. Acting on a report stays gated on
   * `manage_reports`, inside the panel.
   *
   * `has("view_reports")`, not `can(...)`: `can` answers true until the server
   * says no, and `server:details` has not arrived the first time this runs, so
   * a guest emitted and got the same toast for a second reason. GRYT-874.
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
    if (canViewReports && accessToken) {
      currentConnection.emit("reports:list", { accessToken });
    }
    return () => { currentConnection.off("reports:list", onReportsList); };
  }, [currentConnection, canViewReports, accessToken]);

  /**
   * The member list, keyed by server user id, whole.
   *
   * This used to copy out three fields — nickname, serverUserId, avatarFileId —
   * which is why none of GRYT-159's identity detail ever reached chat: it was
   * dropped here, one layer above the components that needed it.
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
