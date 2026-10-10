import { GUIDELINES_URL, TERMS_URL } from "@gryt/core";
import { Trans } from "react-i18next";

import { useTranslation } from "@/i18n";
import { ConfirmDialog } from "@/socket/src/components/ConfirmDialog";

import { termsGate, useAskingToAgree } from "../lib/termsGate";

/** Asked before the first message leaves this device. The phone app asks with the same words. */
export function TermsPrompt() {
  const { t: tr } = useTranslation();
  const open = useAskingToAgree();

  return (
    <ConfirmDialog
      open={open}
      title={tr("terms.title")}
      description={
        /* Spans, because the description is a <p> and a second paragraph can't go inside one. */
        <>
          <span className="block">
            <Trans i18nKey="terms.agreement" components={{
              terms: <a className="gryt-link" href={TERMS_URL} target="_blank" rel="noopener noreferrer" />,
              guidelines: <a className="gryt-link" href={GUIDELINES_URL} target="_blank" rel="noopener noreferrer" />,
            }} />
          </span>
          <span className="mt-2 block">
            {tr("terms.conduct")}
          </span>
        </>
      }
      cancelLabel={tr("terms.notNow")}
      focusCancel
      confirmLabel={tr("terms.agree")}
      confirmTone="primary"
      onConfirm={termsGate.agree}
      onCancel={termsGate.decline}
    />
  );
}
