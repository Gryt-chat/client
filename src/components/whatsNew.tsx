import { useEffect, useState } from "react";

import { getUserValue, loadedUserId, onUserStoreLoaded, setUserValue } from "@/settings";
import { useWhatsNewRequested } from "@/socket";

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

/* A desktop app opens before the wifi is up, and the site rebuilds on a timer
   after a release. One attempt at launch missed both (GRYT-1110). */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000];

/** Waits, or gives up early once the component has gone. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** The line for this version, once the site has one to give. */
async function findEntry(version: string, signal: AbortSignal): Promise<Entry | null> {
  for (let attempt = 0; !signal.aborted; attempt++) {
    try {
      /* no-cache, not the default. nginx sends max-age=600, and the ten
         minutes after an update are the ten that matter. */
      const res = await fetch(CHANGELOG_URL, { cache: "no-cache", signal });
      const data = res.ok ? ((await res.json()) as { app?: Entry[] } | null) : null;
      const found = data?.app?.find((e) => e.version === version);
      if (found) return found;
    } catch {
      // Offline, or the site is down. Nothing to tell anybody about, and the
      // next attempt is coming.
    }

    if (attempt >= RETRY_DELAYS_MS.length) break;
    await sleep(RETRY_DELAYS_MS[attempt], signal);
  }

  return null;
}

/**
 * What changed, the first time somebody opens a version they have not seen. The
 * hand-written changelog lines, not the release body of commit subjects.
 */
export function WhatsNew() {
  const version = __APP_VERSION__;
  const [entry, setEntry] = useState<Entry | null>(null);
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

    void findEntry(version, abort.signal).then((found) => {
      if (!found || abort.signal.aborted) return;
      setEntry(found);
      /* Only once it has actually been shown. A line written twenty minutes
         after the release would otherwise be missed for good. */
      setUserValue(SEEN_KEY, version);
    });

    return () => abort.abort();
  }, [version, storeUser, asked]);

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
