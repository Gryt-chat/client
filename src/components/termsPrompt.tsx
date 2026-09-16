import { ConfirmDialog } from "@/socket/src/components/ConfirmDialog";

import { GUIDELINES_URL, TERMS_URL } from "../lib/termsAgreement";
import { termsGate, useAskingToAgree } from "../lib/termsGate";

/** Asked before the first message leaves this device. The phone app asks with the same words. */
export function TermsPrompt() {
  const open = useAskingToAgree();

  return (
    <ConfirmDialog
      open={open}
      title="Before you post"
      description={
        /* Spans, because the description is a <p> and a second paragraph can't go inside one. */
        <>
          <span className="block">
            Please agree to the{" "}
            <a className="gryt-link" href={TERMS_URL} target="_blank" rel="noopener noreferrer">
              Terms of Use
            </a>{" "}
            and the{" "}
            <a className="gryt-link" href={GUIDELINES_URL} target="_blank" rel="noopener noreferrer">
              Community Guidelines
            </a>
            .
          </span>
          <span className="mt-2 block">
            Abusive content and abusive people aren&rsquo;t tolerated. You can report both, and
            block anyone who bothers you.
          </span>
        </>
      }
      cancelLabel="Not now"
      focusCancel
      confirmLabel="Agree"
      confirmTone="primary"
      onConfirm={termsGate.agree}
      onCancel={termsGate.decline}
    />
  );
}
