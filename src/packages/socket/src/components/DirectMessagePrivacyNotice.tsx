import { PiLockOpen } from "react-icons/pi";

/**
 * What a direct message does not protect you from.
 *
 * A DM looks private. It sits away from the channels, it is between two people,
 * and nothing on screen suggests anybody else is reading — so the fact that
 * whoever runs the server can read it belongs here, above the box somebody is
 * about to type into, rather than in a document they will never open.
 *
 * Quiet on purpose. This is a standing property of the conversation, not an
 * alert: it is true every time and shouting it every time would teach people to
 * stop seeing it. One muted line, and a link for the detail.
 *
 * Not dismissible, for the same reason. A fact that stays true should not be
 * something you can agree never to be told again — and it is one line.
 *
 * ## It says less than it eventually will
 *
 * Encryption does not exist yet (GRYT-709). So there is no "sign in to encrypt
 * this" here, because signing in would not encrypt anything today, and an offer
 * nobody can take is worse than no offer.
 *
 * When encryption lands this becomes conditional — shown when a conversation
 * cannot be encrypted, saying which of the people in it cannot hold a key, with
 * a way to fix it where there is one. The sentence below stays true in that
 * world; it just stops being the only thing this component says.
 */

const SECURITY_DOC =
  "https://docs.gryt.chat/docs/guide/security#direct-messages-are-not-private-from-the-server";

export function DirectMessagePrivacyNotice() {
  return (
    <div
      className="flex items-start gap-2"
      style={{ marginBottom: "12px", paddingInline: "2px" }}
    >
      <PiLockOpen
        aria-hidden="true"
        size={14}
        style={{ color: "var(--gryt-neutral-10)", flexShrink: 0, marginTop: "2px" }}
      />
      <p
        className="m-0 text-xs"
        style={{ color: "var(--gryt-neutral-11)", lineHeight: 1.5 }}
      >
        This conversation isn&rsquo;t encrypted. Whoever runs this server can read
        it.{" "}
        <a
          className="underline"
          href={SECURITY_DOC}
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
