import { useEffect, useState } from "react";

import { type FetchInfo, fetchServerInfo } from "./useServerJoin";

/**
 * The one Gryt server we run ourselves.
 *
 * Hardcoded rather than configured. It is already hardcoded in the Terms, the
 * Privacy page and the Community Guidelines, and a value that has to agree with
 * three published legal pages is not one anybody should be able to point
 * somewhere else from a settings field.
 */
export const OFFICIAL_SERVER_HOST = "community.gryt.chat";

export interface OfficialServer {
  host: string;
  /**
   * What it says about itself, or null when it answered but keeps its public
   * info switched off. Either way it is up, which is the question here.
   */
  info: FetchInfo | null;
}

/**
 * Remembered across dialogs, because the answer does not change while the app
 * is open and the dialog is opened more than once.
 *
 * Only a server that answered is cached. Caching "unreachable" would mean
 * somebody who opened the dialog on a train never sees the row again until they
 * restart, and unreachable is the answer a bad minute of network gives.
 */
let cached: OfficialServer | null = null;

/**
 * Whether there is an official server to offer, and what it calls itself.
 *
 * A probe rather than a constant because the row it feeds is an offer: a server
 * that does not answer must not be suggested. `/info` is the same endpoint the
 * preview below the field uses, so an answer here means the join that follows
 * will get one too.
 */
export function useOfficialServer(enabled: boolean): OfficialServer | null {
  const [server, setServer] = useState<OfficialServer | null>(cached);

  useEffect(() => {
    if (!enabled || server) return;

    const controller = new AbortController();

    void (async () => {
      const result = await fetchServerInfo(OFFICIAL_SERVER_HOST, controller.signal);
      if (controller.signal.aborted) return;

      if (result.kind !== "info" && result.kind !== "private") return;

      cached = {
        host: OFFICIAL_SERVER_HOST,
        info: result.kind === "info" ? result.info : null,
      };
      setServer(cached);
    })();

    return () => controller.abort();
  }, [enabled, server]);

  return server;
}
