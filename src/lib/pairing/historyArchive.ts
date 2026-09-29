import type { HistoryArchive } from "@gryt/core";

import type { MessageArchive } from "@/common";

import { toHistoryRecord } from "./historyRecords.ts";

/** This device's archive, read for the history a newly linked device gets (GRYT-1484). */
export function historyArchive(archive: Pick<MessageArchive, "conversations" | "page">): HistoryArchive {
  return {
    conversations: () => archive.conversations(),
    async page(scope, conversationId, { before, limit }) {
      return (await archive.page(scope, conversationId, { before, limit })).map(toHistoryRecord);
    },
  };
}
