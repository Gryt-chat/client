import { ContextMenu, Flex } from "@radix-ui/themes";
import React, { type ReactNode } from "react";
import { MdCloudDownload, MdContentCopy, MdOpenInNew } from "react-icons/md";

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
      <ContextMenu.Trigger onContextMenu={(e: React.MouseEvent) => e.stopPropagation()}>
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Content style={{ minWidth: 180 }}>
        <ContextMenu.Item onClick={() => triggerDownload(src, fileName)}>
          <Flex align="center" gap="1">
            <MdCloudDownload size={14} />
            Save As
          </Flex>
        </ContextMenu.Item>
        <ContextMenu.Item onClick={() => copyToClipboard(src)}>
          <Flex align="center" gap="1">
            <MdContentCopy size={14} />
            Copy Link
          </Flex>
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onClick={() => window.open(src, "_blank", "noopener,noreferrer")}>
          <Flex align="center" gap="1">
            <MdOpenInNew size={14} />
            Open in Browser
          </Flex>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
  );
}
