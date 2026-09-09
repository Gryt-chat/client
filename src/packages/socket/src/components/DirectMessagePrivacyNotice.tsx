import type { SealDecision } from "@/common";

import { PiLockOpen, PiLockSimpleFill } from "../../../../lib/icons";

/**
 * What a direct message does and does not protect you from. **Quiet, and not
 * dismissible**: it is a standing property rather than an alert.
 */

/* The plaintext anchor names a section that contradicts the sealed sentence,
   so that case links to the guide root. */
const SECURITY_DOC_PLAINTEXT =
  "https://docs.gryt.chat/docs/about/security#direct-messages-are-not-private-from-the-server";
const SECURITY_DOC_SEALED = "https://docs.gryt.chat/docs/about/security";

/**
 * Why it fell back, in the words somebody would use about a person. What matters
 * to the reader is whether this will sort itself out.
 */
function plaintextReason(decision: SealDecision | undefined): string | null {
  if (!decision || decision.kind !== "plaintext") return null;
  const reasons = new Set(decision.blockedBy.map((b) => b.reason));
  if (reasons.has("changed")) return "Somebody here changed their key.";
  if (reasons.has("unusable")) return "Somebody here has a key this app can't use.";
  if (reasons.has("no-key")) return "Somebody here hasn't set up a key yet.";
  return null;
}

export function DirectMessagePrivacyNotice({
  decision,
  peerInClear,
}: {
  decision?: SealDecision;
  /* Who sent the newest message without encrypting it, while we can. Their app
     has decided it cannot seal to us, and nothing else here would say so. */
  peerInClear?: string | null;
}) {
  const sealed = decision?.kind === "seal";
  const oneWay = sealed && !!peerInClear;
  const reason = plaintextReason(decision);

  /*
   * Unknown reads as unencrypted on purpose. Of the two ways to be wrong while
   * the keys are fetched, understating the protection costs nothing.
   */
  const Icon = sealed && !oneWay ? PiLockSimpleFill : PiLockOpen;

  return (
    <div
      className="flex items-start gap-2"
      style={{ marginBottom: "12px", paddingInline: "2px" }}
    >
      <Icon
        aria-hidden="true"
        size={14}
        style={{ color: "var(--gryt-neutral-10)", flexShrink: 0, marginTop: "2px" }}
      />
      <p
        className="m-0 text-xs"
        style={{ color: "var(--gryt-neutral-11)", lineHeight: 1.5 }}
      >
        {oneWay ? (
          <>
            You are encrypting, {peerInClear} isn&rsquo;t. Whoever runs this
            server can&rsquo;t read what you send, and can read what they
            send.{" "}
          </>
        ) : sealed ? (
          <>
            This conversation is encrypted. Whoever runs this server can&rsquo;t
            read it.{" "}
          </>
        ) : (
          <>
            This conversation isn&rsquo;t encrypted. Whoever runs this server can
            read it.{reason ? ` ${reason}` : ""}{" "}
          </>
        )}
        <a
          className="underline"
          href={sealed && !oneWay ? SECURITY_DOC_SEALED : SECURITY_DOC_PLAINTEXT}
          rel="noreferrer"
          style={{ color: "var(--gryt-neutral-12)" }}
          target="_blank"
        >
          Read more
        </a>
      </p>
    </div>
  );
}
