import { useEffect, useState } from "react";

import { type FetchInfo, fetchServerInfo } from "./useServerJoin";

/**
 * The one Gryt server we run ourselves. Hardcoded, because it is already
 * hardcoded in the Terms, the Privacy page and the Community Guidelines.
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
 * Remembered across dialogs. Only a server that answered is cached: caching
 * "unreachable" would hide the row until a restart after one bad minute.
 */
let cached: OfficialServer | null = null;

/**
 * Whether there is an official server to offer, and what it calls itself. A probe
 * rather than a constant, because the row it feeds is an offer.
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
