import type { HistorySink } from "@gryt/core";

import type { MessageArchive } from "@/common";

import { fromHistoryRecord } from "./historyRecords.ts";

/** Where a linked device keeps the history it's handed (GRYT-1484). A throw ends it as history_failed. */
export function historySink(archive: () => Promise<Pick<MessageArchive, "put">>): HistorySink {
  return {
    async put(records) {
      const messages = records.map(fromHistoryRecord).filter((m) => m !== null);
      if (messages.length) await (await archive()).put(messages);
    },
  };
}
