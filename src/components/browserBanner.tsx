import { IconButton } from "@gryt/ui";
import { useState } from "react";
import { PiDownloadSimpleFill, PiX } from "react-icons/pi";

import { isElectron } from "../lib/electron";

const STORAGE_KEY = "browserBannerDismissed";

export function BrowserBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

  if (isElectron() || dismissed) return null;

  return (
    <div className="flex items-center justify-center gap-2 px-3 py-1" style={{
        flexShrink: 0,
        background: "var(--gryt-accent-a3)",
        borderBottom: "1px solid var(--gryt-accent-a5)",
      }}>
      <PiDownloadSimpleFill size={14} style={{ flexShrink: 0, color: "var(--gryt-accent-11)" }} />
      <span className="text-xs" style={{ color: "var(--gryt-accent-11)" }}>
        You&apos;re using Gryt in your browser. Some features are limited.{" "}
        <a
          className="font-medium text-gryt-accent underline-offset-2 hover:underline"
          href="https://github.com/Gryt-chat/gryt/releases"
          target="_blank"
          rel="noreferrer"
        >
          Download the desktop app
        </a>{" "}
        for the full experience.
      </span>
      <IconButton tone="ghost" size="xsmall"
        style={{ marginLeft: "auto", flexShrink: 0 }}
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, "true");
          setDismissed(true);
        }}
        aria-label="Dismiss banner"
      >
        <PiX size={14} />
      </IconButton>
    </div>
  );
}
