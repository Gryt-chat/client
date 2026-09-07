import { IconButton } from "@gryt/ui";
import { useEffect, useState } from "react";
import { PiWarningFill, PiX } from "react-icons/pi";

import { getGrytConfig } from "../config";
import {
  decideBanner,
  fetchDeclaredStatus,
  POLL_INTERVAL_MS,
  probeAccountServices,
  type ServiceBanner,
} from "../lib/serviceStatus";
import { useAccount } from "../packages/common/src/hooks/useAccount";

const DISMISSED_KEY = "serviceStatusDismissed";

const GENERIC = {
  title: "Can't reach Gryt's account services",
  body: "You can keep using servers you're already in. Signing in or out won't work until this clears.",
  link: "https://discord.gg/Q3JKUGsnHE",
  linkLabel: "What's going on?",
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

    const check = async () => {
      /* The OS knows better than a failed fetch does. Someone on a train with
         no signal should not be told Gryt is having an outage. */
      if (!navigator.onLine) {
        failures = 0;
        if (!cancelled) setBanner(null);
        return;
      }

      const declared = await fetchDeclaredStatus();

      /* Only probe when there is nothing posted — a declared notice wins
         either way, so the request would change nothing. */
      if (!declared) {
        const reachable = await probeAccountServices(getGrytConfig().GRYT_OIDC_ISSUER);
        failures = reachable ? 0 : failures + 1;
      } else {
        failures = 0;
      }

      if (!cancelled) setBanner(decideBanner(declared, failures));
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

  const shown = banner.kind === "declared" ? banner.status : GENERIC;
  if (shown.title === dismissed) return null;

  return (
    <div
      className="flex items-center justify-center gap-2 px-3 py-1"
      role="status"
      style={{
        flexShrink: 0,
        background: "color-mix(in oklab, var(--gryt-warning-9) 10%, transparent)",
        borderBottom:
          "1px solid color-mix(in oklab, var(--gryt-warning-9) 20%, transparent)",
      }}
    >
      <PiWarningFill
        size={14}
        style={{ flexShrink: 0, color: "var(--gryt-warning-11)" }}
      />
      <span className="text-xs" style={{ color: "var(--gryt-warning-11)" }}>
        <span className="font-medium">{shown.title}</span>
        {shown.body ? ` ${shown.body}` : null}
        {shown.link ? (
          <>
            {" "}
            <a
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--gryt-warning-11)" }}
              href={shown.link}
              target="_blank"
              rel="noreferrer"
            >
              {shown.linkLabel}
            </a>
          </>
        ) : null}
      </span>
      <IconButton
        tone="ghost"
        size="xsmall"
        aria-label="Dismiss"
        style={{ marginLeft: "auto", flexShrink: 0 }}
        onClick={() => {
          localStorage.setItem(DISMISSED_KEY, shown.title);
          setDismissed(shown.title);
        }}
      >
        <PiX size={12} />
      </IconButton>
    </div>
  );
}
