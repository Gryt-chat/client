import type { HistoryFetch, ServerAccess } from "@gryt/core";

import { getServerAccessToken, getServerHttpBase } from "@/common";

/** How this device reaches a server for a linked device's history (GRYT-2055). */
export const serverAccess: ServerAccess = { base: (host) => getServerHttpBase(host), token: getServerAccessToken };

export const historyFetch: HistoryFetch = (url, init) => fetch(url, init as RequestInit);
