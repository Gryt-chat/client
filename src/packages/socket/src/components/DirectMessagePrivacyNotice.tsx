import type { SealDecision } from "@/common";

import { PiLockOpen, PiLockSimpleFill } from "../../../../lib/icons";

/**
 * What a direct message does and does not protect you from.
 *
 * A DM looks private either way, so which of the two it actually is belongs
 * above the box somebody is about to type into rather than in a document they
 * never open.
 *
 * **Quiet, and not dismissible.** It is a standing property rather than an
 * alert: shouting it every time teaches people to stop seeing it, and a fact
 * that stays true should not be something you agree never to be told again.
 *
 * This said "This conversation isn't encrypted" with no condition on it from
 * GRYT-709 until 2026-09-06. Encryption landed in GRYT-729 and nobody came
 * back, so for that whole stretch it told people something false about a
 * conversation that was in fact sealed — while the messages in it visibly
 * failed to open, which is a confusing pair to be handed at once.
 */

/* The anchor is the section about the server being able to read a DM, so it
   only fits the plaintext case. The sealed case links to the guide itself
   rather than to a heading that contradicts the sentence above it. */
const SECURITY_DOC_PLAINTEXT =
  "https://docs.gryt.chat/docs/guide/security#direct-messages-are-not-private-from-the-server";
const SECURITY_DOC_SEALED = "https://docs.gryt.chat/docs/guide/security";

/**
 * Why it fell back, in the words somebody would use about a person.
 *
 * `blockedBy` names members, and naming them here would mean resolving
 * nicknames this component does not have. What matters to the reader is
 * whether this is something that will sort itself out.
 */
function plaintextReason(decision: SealDecision | undefined): string | null {
  if (!decision || decision.kind !== "plaintext") return null;
  const reasons = new Set(decision.blockedBy.map((b) => b.reason));
  if (reasons.has("changed")) return "Somebody here changed their key.";
  if (reasons.has("unusable")) return "Somebody here has a key this app can't use.";
  if (reasons.has("no-key")) return "Somebody here hasn't set up a key yet.";
  return null;
}

export function DirectMessagePrivacyNotice({ decision }: { decision?: SealDecision }) {
  const sealed = decision?.kind === "seal";
  const reason = plaintextReason(decision);

  /*
   * Unknown reads as unencrypted on purpose. The decision is undefined while
   * the member keys are still being fetched, and of the two ways to be wrong
   * for that second, telling somebody they have less protection than they do
   * is the one that costs them nothing.
   */
  const Icon = sealed ? PiLockSimpleFill : PiLockOpen;

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
        {sealed ? (
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
          href={sealed ? SECURITY_DOC_SEALED : SECURITY_DOC_PLAINTEXT}
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
