import { useEffect, useState } from "react";

import { IS_BETA_BUILD } from "@/common";
import { getUserValue, loadedUserId, onUserStoreLoaded, setUserValue } from "@/settings";
import { useWhatsNewRequested } from "@/socket";

import { loadChangelog } from "../lib/changelogFeed";
import { WhatsNewDialog } from "../packages/socket/src/components/WhatsNewDialog";
import { type Release, type ReleasesToShow, releasesToShow } from "./whatsNewSince";

const SEEN_KEY = "whatsNewSeenVersion";

/** Whether this install has ever joined a server, which a fresh one has not. */
function hasJoinedAnything(): boolean {
  const servers = getUserValue<Record<string, unknown> | null>("servers", null);
  return !!servers && Object.keys(servers).length > 0;
}

/** Every app release, once the site has a line for this version. A copy the security notice already fetched will do. */
async function findReleases(version: string, signal: AbortSignal): Promise<Release[] | null> {
  const feed = await loadChangelog(signal, {
    accept: (data) => Array.isArray(data.app) && data.app.some((e: Release) => e?.version === version),
    maxAgeMs: Infinity,
  });
  return feed ? (feed.app as Release[]) : null;
}

/**
 * What changed, the first time somebody opens a version they have not seen. The
 * hand-written changelog lines, not the release body of commit subjects.
 */
export function WhatsNew() {
  const version = __APP_VERSION__;
  const [shown, setShown] = useState<ReleasesToShow | null>(null);
  const asked = useWhatsNewRequested();
  /* Read on mount this saw an empty store every launch, called that a fresh
     install, and wrote a version nobody was loaded to write against. */
  const [storeUser, setStoreUser] = useState<string | null>(loadedUserId);

  useEffect(() => onUserStoreLoaded(setStoreUser), []);

  useEffect(() => {
    if (!storeUser) return;

    /* Asked for from the About page, so what has been seen does not apply. */
    const seen = getUserValue<string | null>(SEEN_KEY, null);
    if (!asked && seen === version) return;

    /* Nothing recorded: a fresh install, or one that ran 1.11.0 or 1.11.1 and
       never got to write it (GRYT-1101). Only the first should stay quiet. */
    if (!asked && seen === null && !hasJoinedAnything()) {
      setUserValue(SEEN_KEY, version);
      return;
    }

    const abort = new AbortController();

    void findReleases(version, abort.signal).then((app) => {
      if (!app || abort.signal.aborted) return;
      /* From About it is this version alone, whatever was seen before. */
      const picked = releasesToShow(app, asked ? null : seen, version, IS_BETA_BUILD);
      if (!picked.releases.length) return;
      setShown(picked);
      /* Only once it has actually been shown. A line written twenty minutes
         after the release would otherwise be missed for good. */
      setUserValue(SEEN_KEY, version);
    });

    return () => abort.abort();
  }, [version, storeUser, asked]);

  if (!shown) return null;

  return (
    <WhatsNewDialog
      releases={shown.releases}
      since={shown.since}
      capped={shown.capped}
      onClose={() => setShown(null)}
    />
  );
}
