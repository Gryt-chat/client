import { Flex, IconButton, Link, Text } from "@radix-ui/themes";
import { useState } from "react";
import { Download as FiDownload, X as FiX } from "lucide-react";

import { isElectron } from "../lib/electron";

const STORAGE_KEY = "browserBannerDismissed";

export function BrowserBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === "true",
  );

  if (isElectron() || dismissed) return null;

  return (
    <Flex
      align="center"
      justify="center"
      gap="2"
      px="3"
      py="1"
      shrink="0"
      style={{
        background: "var(--accent-a3)",
        borderBottom: "1px solid var(--accent-a5)",
      }}
    >
      <FiDownload size={13} style={{ flexShrink: 0, color: "var(--accent-11)" }} />
      <Text size="1" style={{ color: "var(--accent-11)" }}>
        You&apos;re using Gryt in your browser. Some features are limited.{" "}
        <Link
          href="https://github.com/Gryt-chat/gryt/releases"
          target="_blank"
          rel="noreferrer"
          size="1"
          weight="medium"
        >
          Download the desktop app
        </Link>{" "}
        for the full experience.
      </Text>
      <IconButton
        variant="ghost"
        color="gray"
        size="1"
        style={{ marginLeft: "auto", flexShrink: 0 }}
        onClick={() => {
          localStorage.setItem(STORAGE_KEY, "true");
          setDismissed(true);
        }}
        aria-label="Dismiss banner"
      >
        <FiX size={14} />
      </IconButton>
    </Flex>
  );
}
