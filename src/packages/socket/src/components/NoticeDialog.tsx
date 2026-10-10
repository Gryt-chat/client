import { AlertDialog, Button } from "@gryt/ui";
import type { ReactNode } from "react";

import { useTranslation } from "@/i18n";

/**
 * Something happened and there is nothing to decide. One button, no Cancel.
 * A confirmation with its Cancel hidden still reads as a question.
 */
export function NoticeDialog({
  open,
  onClose,
  title,
  message,
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  message?: ReactNode;
  closeLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop />
        <AlertDialog.Popup>
          <AlertDialog.Title>{title}</AlertDialog.Title>
          {message && (
            <AlertDialog.Description className="mt-2">{message}</AlertDialog.Description>
          )}
          <div className="flex gap-3 mt-4 justify-end">
            <AlertDialog.Close render={<Button size="small" tone="neutral">{closeLabel ?? t("ui.gotIt")}</Button>} />
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
