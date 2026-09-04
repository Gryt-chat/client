import { Button } from "@gryt/ui";
import { PiWarningFill, PiX } from "react-icons/pi";

import {
  dismissServerNotice,
  type ServerNotice,
  useServerNotice,
} from "@/common";

/**
 * Where the installer comes from.
 *
 * Not GitHub Releases: that is a page of notes above a collapsed Assets list of
 * a dozen files across three platforms, and the person reading this is stuck on
 * a client that cannot update itself. This resolves the current build for the
 * platform in the query and starts the download on arrival.
 */
const INSTALLER_URL = "https://gryt.chat/download?os=windows";
const INSTRUCTIONS_URL = "https://docs.gryt.chat/docs/client/updates";

/**
 * Every word a notice can put on screen.
 *
 * The server sends `{ kind, version }` and nothing else, so there is no
 * arrangement of bytes it can send that puts a sentence — or a link — in front
 * of somebody. Adding a kind means adding a case here and shipping a release.
 */
function copyFor(notice: ServerNotice) {
  switch (notice.kind) {
    case "outdated_client":
      return {
        title: "This client can't update itself",
        body: `Gryt ${notice.version} on Windows downloads every new release and installs none of them. Installing is the step that fails, so it can't repair itself.`,
        detail:
          "Download the current installer, close Gryt including the tray icon, and run it. Updates work on their own again afterwards, and your settings and servers are untouched.",
        action: { label: "Download the installer", href: INSTALLER_URL },
        more: { label: "Full instructions", href: INSTRUCTIONS_URL },
      };
  }
}

/**
 * A notice from the server, for the person it is about.
 *
 * Below the channel header and above the messages, so it sits inside the
 * server's area rather than in the app's own chrome. Anything painted in Gryt's
 * chrome should only ever be Gryt, and this is somebody else's machine talking
 * — which is what "From <server>, only to you" in the frame is for. The links
 * are ours, hardcoded above; a server cannot reach them.
 */
export function ServerNoticePanel({
  host,
  serverName,
}: {
  host: string | undefined;
  serverName: string;
}) {
  const notice = useServerNotice(host);
  if (!notice || !host) return null;

  const copy = copyFor(notice);

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-(--gryt-radius-md) px-4 py-3 mx-3 mt-2"
      style={{
        border: "1px solid var(--gryt-border)",
        borderLeft: "3px solid var(--gryt-warning-11)",
        /* The warning tint, not the plain surface. A notice on `neutral-3`
           reads as another panel; the point of this one is that it is the one
           thing on the screen asking for something. */
        background: "var(--gryt-warning-3)",
      }}
    >
      <span
        className="shrink-0"
        style={{ color: "var(--gryt-warning-11)", marginTop: 2 }}
      >
        <PiWarningFill size={16} />
      </span>

      <div className="flex flex-col" style={{ minWidth: 0, flex: 1 }}>
        <span className="text-xs" style={{ color: "var(--gryt-neutral-11)" }}>
          From <b style={{ color: "var(--gryt-text)" }}>{serverName}</b>, only to you
        </span>
        <span className="text-sm font-bold" style={{ marginTop: 2 }}>
          {copy.title}
        </span>
        <span className="text-sm" style={{ marginTop: 2 }}>
          {copy.body}
        </span>
        <span className="text-xs" style={{ color: "var(--gryt-neutral-11)", marginTop: 4 }}>
          {copy.detail}
        </span>

        <div className="flex flex-wrap items-center gap-2" style={{ marginTop: 10 }}>
          <Button
            size="xsmall"
            onClick={() => window.open(copy.action.href, "_blank", "noopener,noreferrer")}
          >
            {copy.action.label}
          </Button>
          <a
            href={copy.more.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs underline"
            style={{ color: "var(--gryt-neutral-11)" }}
          >
            {copy.more.label}
          </a>
        </div>
      </div>

      {/* Dismissal is per device and permanent, and the server is not told. A
          server learning which of its notices somebody has silenced is the
          beginning of working around it. */}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissServerNotice(host, notice.kind)}
        className="shrink-0 cursor-pointer appearance-none border-0 bg-transparent p-1 rounded-(--gryt-radius-md)"
        style={{ color: "var(--gryt-neutral-11)" }}
      >
        <PiX size={14} />
      </button>
    </div>
  );
}
