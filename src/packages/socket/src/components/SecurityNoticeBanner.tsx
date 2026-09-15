import { IconButton } from "@gryt/ui";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { getChangelog, loadChangelog, subscribeChangelog } from "../../../../lib/changelogFeed";
import { PiShieldWarningFill, PiX } from "../../../../lib/icons";
import {
  dismissalSnapshot,
  dismissedNotices,
  dismissNotices,
  managesServer,
  noticeForServer,
  parseSecurityNotices,
  securityNoticeText,
  subscribeDismissals,
} from "../../../../lib/securityNotices";

/** How old a copy of the changelog gets before an app left open asks again. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const RECHECK_MS = 60 * 60 * 1000;

/** The changelog, fetched only while somebody here manages the server on screen. */
function useChangelog(wanted: boolean) {
  const feed = useSyncExternalStore(subscribeChangelog, getChangelog, getChangelog);

  useEffect(() => {
    if (!wanted) return;
    const abort = new AbortController();
    const refresh = () => void loadChangelog(abort.signal, { maxAgeMs: MAX_AGE_MS });
    refresh();
    const timer = setInterval(refresh, RECHECK_MS);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [wanted]);

  return feed;
}

/**
 * Tells an owner or admin that the server on screen is older than a published
 * security fix. Gryt talking about the server, so it sits above the server's own view.
 */
export function SecurityNoticeBanner({
  host,
  serverInfo,
  hostedHere,
}: {
  host: string;
  serverInfo: { is_owner?: boolean; role?: string; version?: string } | undefined;
  hostedHere: boolean;
}) {
  const manages = managesServer(serverInfo);
  const feed = useChangelog(manages);
  const notices = useMemo(() => parseSecurityNotices(feed?.securityNotices), [feed]);
  const dismissals = useSyncExternalStore(subscribeDismissals, dismissalSnapshot, dismissalSnapshot);
  const dismissed = useMemo(() => dismissedNotices(host, dismissals), [host, dismissals]);

  if (!manages) return null;
  const notice = noticeForServer(notices, serverInfo?.version, dismissed);
  if (!notice) return null;

  return (
    <div
      role="status"
      aria-label="Security notice"
      className="flex items-center gap-3 px-3 py-2"
      style={{
        flexShrink: 0,
        borderRadius: "var(--gryt-radius-lg)",
        background: "color-mix(in oklab, var(--gryt-warning-9) 7%, transparent)",
        border: "1px solid color-mix(in oklab, var(--gryt-warning-9) 13%, transparent)",
      }}
    >
      <PiShieldWarningFill size={16} style={{ flexShrink: 0, color: "var(--gryt-warning-11)" }} />
      <span className="text-sm" style={{ flex: 1, minWidth: 0 }}>
        {securityNoticeText(notice.fixedIn, hostedHere)}{" "}
        <a
          className="gryt-link font-medium"
          href={notice.url}
          title={notice.title || undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          Details
        </a>
      </span>
      <IconButton
        tone="ghost"
        size="xsmall"
        aria-label="Dismiss"
        style={{ flexShrink: 0 }}
        onClick={() => dismissNotices(host, notice.ids)}
      >
        <PiX size={12} />
      </IconButton>
    </div>
  );
}
