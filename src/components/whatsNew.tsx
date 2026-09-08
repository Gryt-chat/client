import { useEffect, useState } from "react";

import { getUserValue, setUserValue } from "@/settings";

import { NoticeDialog } from "../packages/socket/src/components/NoticeDialog";

/** The site emits this on every build. See the site's emit-changelog-json.mjs. */
const CHANGELOG_URL = "https://gryt.chat/changelog.json";

const SEEN_KEY = "whatsNewSeenVersion";

interface Entry {
  version: string;
  date: string;
  line: string;
  note?: boolean;
}

/**
 * What changed, the first time somebody opens a version they have not seen. The
 * hand-written changelog line, not the release body of commit subjects.
 */
export function WhatsNew() {
  const version = __APP_VERSION__;
  const [entry, setEntry] = useState<Entry | null>(null);

  useEffect(() => {
    const seen = getUserValue<string | null>(SEEN_KEY, null);
    if (seen === version) return;

    /* A fresh install has nothing to compare against. Announcing the version
       somebody just chose to install reads as a bug, so record and stay quiet. */
    if (seen === null) {
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
  }, [version]);

  if (!entry) return null;

  return (
    <NoticeDialog
      open
      onClose={() => setEntry(null)}
      title={`What's new in Gryt ${entry.version}`}
      message={
        <>
          <span style={{ display: "block" }}>{entry.line}</span>
          <a
            href={`https://gryt.chat/changelog/${entry.version}`}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-block", marginTop: 10 }}
          >
            {entry.note ? "Read the full notes" : "See every change"}
          </a>
        </>
      }
      closeLabel="Got it"
    />
  );
}
