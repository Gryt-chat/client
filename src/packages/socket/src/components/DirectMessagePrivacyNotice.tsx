import { PiLockOpen } from "react-icons/pi";

/**
 * What a direct message does not protect you from. A DM looks private, so the
 * fact that whoever runs the server can read it belongs above the box somebody
 * is about to type into rather than in a document they never open.
 *
 * **Quiet, and not dismissible.** It is a standing property rather than an
 * alert: shouting it every time teaches people to stop seeing it, and a fact
 * that stays true should not be something you agree never to be told again.
 *
 * When encryption lands (GRYT-709) this becomes conditional — shown when a
 * conversation cannot be encrypted, naming who cannot hold a key.
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
