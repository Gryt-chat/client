import { IconButton } from "@gryt/ui";
import { useState } from "react";

import { useTranslation } from "@/i18n";

import { isElectron } from "../lib/electron";
import { PiDownloadSimpleFill, PiX } from "../lib/icons";

const STORAGE_KEY = "browserBannerDismissed";

export function BrowserBanner() {
  const { t: tr } = useTranslation();
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
        {tr("launch.browser")}{" "}
        <a
          className="gryt-link font-medium"
          href="https://github.com/Gryt-chat/gryt/releases"
          target="_blank"
          rel="noreferrer"
        >
          {tr("launch.download")}
        </a>{" "}
        {tr("launch.fullExperience")}
      </span>
      <IconButton tone="ghost" size="xsmall"
        style={{ marginLeft: "auto", flexShrink: 0 }}
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, "true");
          setDismissed(true);
        }}
        aria-label={tr("launch.dismissBanner")}
      >
        <PiX size={14} />
      </IconButton>
    </div>
  );
}
