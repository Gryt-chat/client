import { IconButton } from "@gryt/ui";
import type { Icon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { getGrytConfig } from "../config";
import {
  PiCheckCircleFill,
  PiInfoFill,
  PiWarningCircleFill,
  PiWarningFill,
  PiX,
} from "../lib/icons";
import {
  type AnnouncementType,
  decideBanner,
  fetchAnnouncement,
  POLL_INTERVAL_MS,
  probeAccountServices,
  type ServiceBanner,
} from "../lib/serviceStatus";
import { useAccount } from "../packages/common/src/hooks/useAccount";

const DISMISSED_KEY = "serviceStatusDismissed";

const STATUS_PAGE = "https://status.gryt.chat";

const GENERIC =
  "Can't reach Gryt's account services. You can keep using servers you're already in, but signing in or out won't work until this clears.";

/**
 * A glyph per severity. It was a triangle whatever the notice said, so an
 * `information` notice arrived as an accent-coloured warning (GRYT-1052).
 */
const ICON: Record<AnnouncementType, Icon> = {
  outage: PiWarningFill,
  warning: PiWarningCircleFill,
  information: PiInfoFill,
  operational: PiCheckCircleFill,
  none: PiInfoFill,
};

/** Gatus's own severities, so the banner and the status page agree on colour. */
const TONE: Record<AnnouncementType, string> = {
  outage: "danger",
  warning: "warning",
  information: "accent",
  operational: "warning",
  none: "warning",
};

/**
 * Signed in only. Somebody who isn't signed in has nothing that breaks when the
 * account services go down, so a banner would be noise.
 */
export function ServiceStatusBanner() {
  const { isSignedIn } = useAccount();
  const [banner, setBanner] = useState<ServiceBanner | null>(null);

  /* Keyed on the text, so dismissing one notice does not hide the next. */
  const [dismissed, setDismissed] = useState<string | null>(() =>
    localStorage.getItem(DISMISSED_KEY),
  );

  useEffect(() => {
    if (!isSignedIn) {
      setBanner(null);
      return;
    }

    let cancelled = false;
    let failures = 0;
    /* Logged once per distinct reason. A feed that has been unreachable for a
       week should say so, not sixty times an hour. */
    let loggedReason = "";

    const check = async () => {
      /* The OS knows better than a failed fetch does. Someone on a train with
         no signal should not be told Gryt is having an outage. */
      if (!navigator.onLine) {
        failures = 0;
        if (!cancelled) setBanner(null);
        return;
      }

      const result = await fetchAnnouncement();

      if (!result.ok && result.reason !== loggedReason) {
        loggedReason = result.reason;
        console.warn(
          `Service status: cannot read the announcements feed — ${result.reason}`,
        );
      }
      if (result.ok) loggedReason = "";

      /* An unreadable feed is not an announcement, and not a reason to invent
         one — the probe below decides that on its own evidence. */
      const announcement = result.ok ? result.announcement : null;

      /* Only probe when nothing is announced — an announcement wins either
         way, so the request would change nothing. */
      if (!announcement) {
        const reachable = await probeAccountServices(getGrytConfig().GRYT_OIDC_ISSUER);
        failures = reachable ? 0 : failures + 1;
      } else {
        failures = 0;
      }

      if (!cancelled) setBanner(decideBanner(announcement, failures));
    };

    check();
    const timer = setInterval(check, POLL_INTERVAL_MS);

    /* Waking up or coming back online is exactly when somebody wants to know
       what they missed, and the timer has not been running. */
    const recheck = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", recheck);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [isSignedIn]);

  if (!banner) return null;

  const message =
    banner.kind === "announced" ? banner.announcement.message : GENERIC;
  const tone =
    banner.kind === "announced" ? TONE[banner.announcement.type] : "warning";
  /* Not reachable is a warning whatever else is going on. */
  const Glyph =
    banner.kind === "announced" ? ICON[banner.announcement.type] : PiWarningFill;

  if (message === dismissed) return null;

  return (
    <div
      className="flex items-center justify-center gap-2 px-3 py-1"
      role="status"
      style={{
        flexShrink: 0,
        background: `color-mix(in oklab, var(--gryt-${tone}-9) 10%, transparent)`,
        borderBottom: `1px solid color-mix(in oklab, var(--gryt-${tone}-9) 20%, transparent)`,
      }}
    >
      <Glyph
        size={14}
        style={{ flexShrink: 0, color: `var(--gryt-${tone}-11)` }}
      />
      <span className="text-xs" style={{ color: `var(--gryt-${tone}-11)` }}>
        {message}{" "}
        <a
          className="font-medium underline-offset-2 hover:underline"
          style={{ color: `var(--gryt-${tone}-11)` }}
          href={STATUS_PAGE}
          target="_blank"
          rel="noreferrer"
        >
          Status page
        </a>
      </span>
      <IconButton
        tone="ghost"
        size="xsmall"
        aria-label="Dismiss"
        style={{ marginLeft: "auto", flexShrink: 0 }}
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, message);
          setDismissed(message);
        }}
      >
        <PiX size={12} />
      </IconButton>
    </div>
  );
}
