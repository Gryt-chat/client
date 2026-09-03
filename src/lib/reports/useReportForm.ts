import type { ReportType } from "@gryt/core";
import { useCallback, useState } from "react";

import { singletonHook } from "@/common";

/**
 * Whether the report form is open, and which of the two it opened as.
 *
 * A singleton because the two rows that open it are in different trees — the
 * avatar menu in the sidebar, and About inside the settings modal — and the
 * form itself is mounted once at the app root next to the other dialogs.
 *
 * The type is the row that opened it. "Give feedback" and "Report a bug" are
 * the same form with a different label on the service, and asking somebody to
 * pick again after they already pressed one of two buttons is asking a question
 * that has been answered.
 */

export interface ReportForm {
  /** The type it opened as, or null when it is closed. */
  openAs: ReportType | null;
  open: (type: ReportType) => void;
  close: () => void;
}

const init: ReportForm = {
  openAs: null,
  open: () => {},
  close: () => {},
};

export const useReportForm = singletonHook<ReportForm>(init, () => {
  const [openAs, setOpenAs] = useState<ReportType | null>(null);

  const open = useCallback((type: ReportType) => setOpenAs(type), []);
  const close = useCallback(() => setOpenAs(null), []);

  return { openAs, open, close };
});
