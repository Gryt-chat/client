import type { ReportType } from "@gryt/core";
import { useCallback, useState } from "react";

import { singletonHook } from "@/common";

/**
 * Whether the report form is open, and which of the two it opened as. A singleton
 * because the two rows that open it are in different trees.
 */

export interface ReportForm {
  /** The type it opened as, or null when it is closed. */
  openAs: ReportType | null;
  /** Text the form starts with, for a report opened from somewhere that knows what it's about. */
  draft: string;
  open: (type: ReportType, draft?: string) => void;
  close: () => void;
}

const init: ReportForm = {
  openAs: null,
  draft: "",
  open: () => {},
  close: () => {},
};

export const useReportForm = singletonHook<ReportForm>(init, () => {
  const [openAs, setOpenAs] = useState<ReportType | null>(null);
  const [draft, setDraft] = useState("");

  const open = useCallback((type: ReportType, text = "") => {
    setDraft(text);
    setOpenAs(type);
  }, []);
  const close = useCallback(() => setOpenAs(null), []);

  return { openAs, draft, open, close };
});
