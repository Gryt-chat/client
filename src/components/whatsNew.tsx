import { useEffect, useState } from "react";

import { getUserValue, loadedUserId, onUserStoreLoaded, setUserValue } from "@/settings";

import {
  type WhatsNewChange,
  WhatsNewDialog,
} from "../packages/socket/src/components/WhatsNewDialog";

/** The site emits this on every build. See the site's emit-changelog-json.mjs. */
const CHANGELOG_URL = "https://gryt.chat/changelog.json";

const SEEN_KEY = "whatsNewSeenVersion";

interface Entry {
  version: string;
  date: string;
  line: string;
  changes?: WhatsNewChange[];
  note?: boolean;
}

/** Whether this install has ever joined a server, which a fresh one has not. */
function hasJoinedAnything(): boolean {
  const servers = getUserValue<Record<string, unknown> | null>("servers", null);
  return !!servers && Object.keys(servers).length > 0;
}

/**
 * What changed, the first time somebody opens a version they have not seen. The
 * hand-written changelog lines, not the release body of commit subjects.
 */
export function WhatsNew() {
  const version = __APP_VERSION__;
  const [entry, setEntry] = useState<Entry | null>(null);
  /* Read on mount this saw an empty store every launch, called that a fresh
     install, and wrote a version nobody was loaded to write against. */
  const [storeUser, setStoreUser] = useState<string | null>(loadedUserId);

  useEffect(() => onUserStoreLoaded(setStoreUser), []);

  useEffect(() => {
    if (!storeUser) return;

    const seen = getUserValue<string | null>(SEEN_KEY, null);
    if (seen === version) return;

    /* Nothing recorded: a fresh install, or one that ran 1.11.0 or 1.11.1 and
       never got to write it (GRYT-1101). Only the first should stay quiet. */
    if (seen === null && !hasJoinedAnything()) {
      setUserValue(SEEN_KEY, version);
      return;
    }

    const abort = new AbortController();

    fetch(CHANGELOG_URL, { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { app?: Entry[] } | null) => {
        const found = data?.app?.find((e) => e.version === version);
        if (!found) return;
        setEntry(found);
        /* Only once it has actually been shown. A line written twenty minutes
           after the release would otherwise be missed for good. */
        setUserValue(SEEN_KEY, version);
      })
      .catch(() => {
        // Offline, or the site is down. There is nothing to tell somebody about
        // that, and the next launch tries again.
      });

    return () => abort.abort();
  }, [version, storeUser]);

  if (!entry) return null;

  return (
    <WhatsNewDialog
      version={entry.version}
      date={entry.date}
      line={entry.line}
      changes={entry.changes}
      onClose={() => setEntry(null)}
    />
  );
}
