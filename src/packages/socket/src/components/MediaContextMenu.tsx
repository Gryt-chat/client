import { ContextMenu } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { FaCloudDownloadAlt, FaCopy, FaExternalLinkAlt } from "react-icons/fa";

interface MediaContextMenuProps {
  children: ReactNode;
  src: string;
  fileName?: string | null;
}

function triggerDownload(url: string, fileName?: string | null) {
  const a = document.createElement("a");
  a.href = url.includes("?") ? `${url}&download=1` : `${url}?download=1`;
  a.download = fileName || "";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

export function MediaContextMenu({ children, src, fileName }: MediaContextMenuProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
      <ContextMenu.Content style={{ minWidth: 180 }}>
        <ContextMenu.Item onClick={() => triggerDownload(src, fileName)}>
          <FaCloudDownloadAlt style={{ marginRight: 8, flexShrink: 0 }} />
          Save As
        </ContextMenu.Item>
        <ContextMenu.Item onClick={() => copyToClipboard(src)}>
          <FaCopy style={{ marginRight: 8, flexShrink: 0 }} />
          Copy Link
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onClick={() => window.open(src, "_blank", "noopener,noreferrer")}>
          <FaExternalLinkAlt style={{ marginRight: 8, flexShrink: 0 }} />
          Open in Browser
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
