import { Badge, Button, Flex, SegmentedControl, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { PiTrashFill } from "react-icons/pi";

import type { EmbeddedLogLine, EmbeddedLogSource } from "../../../../lib/electron";
import { getElectronAPI } from "../../../../lib/electron";

const SOURCE_LABEL: Record<EmbeddedLogSource, string> = {
  server: "Server",
  sfu: "SFU",
  worker: "Image worker",
};

const LEVEL_COLOR = {
  error: "red",
  warn: "amber",
  info: "gray",
  debug: "blue",
} as const;

/** Everything at or above the chosen level, so "warn" still shows errors. */
const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 } as const;

/**
 * What the three processes Gryt hosts are saying.
 *
 * They already write to the main process console, which is invisible from
 * inside the app — so when a hosted server misbehaved the only way to find out
 * why was to leave Gryt and read a log file.
 */
export function EmbeddedServerLogs({ serverId }: { serverId: string }) {
  const [lines, setLines] = useState<EmbeddedLogLine[]>([]);
  const [source, setSource] = useState<EmbeddedLogSource | "all">("all");
  const [level, setLevel] = useState<keyof typeof LEVEL_RANK>("info");
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  useEffect(() => {
    const api = getElectronAPI();
    if (!api) return;

    // The history first, so opening this after something has already gone
    // wrong shows the thing that went wrong.
    void api.getEmbeddedServerLogs(serverId).then(setLines);

    return api.onEmbeddedServerLog((entry) => {
      if (!entry.lines?.length) return;
      // This server's lines, plus the SFU's — that one is shared, and it is
      // where the reason voice failed shows up, so filtering it out would hide
      // the answer to the question this pane is usually open for.
      const mine = entry.lines.filter(
        (l) => l.serverId === serverId || l.serverId === null,
      );
      if (!mine.length) return;
      setLines((prev) => [...prev, ...mine].slice(-2000));
    });
  }, [serverId]);

  const visible = useMemo(
    () =>
      lines.filter(
        (l) =>
          (source === "all" || l.source === source) &&
          LEVEL_RANK[l.level] >= LEVEL_RANK[level],
      ),
    [lines, source, level],
  );

  // Follow the tail, but stop the moment the user scrolls up to read something.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="3" wrap="wrap">
        <SegmentedControl.Root
          size="1"
          value={source}
          onValueChange={(v) => setSource(v as EmbeddedLogSource | "all")}
        >
          <SegmentedControl.Item value="all">All</SegmentedControl.Item>
          <SegmentedControl.Item value="server">Server</SegmentedControl.Item>
          <SegmentedControl.Item value="sfu">SFU</SegmentedControl.Item>
          <SegmentedControl.Item value="worker">Worker</SegmentedControl.Item>
        </SegmentedControl.Root>

        <SegmentedControl.Root
          size="1"
          value={level}
          onValueChange={(v) => setLevel(v as keyof typeof LEVEL_RANK)}
        >
          <SegmentedControl.Item value="debug">Debug</SegmentedControl.Item>
          <SegmentedControl.Item value="info">Info</SegmentedControl.Item>
          <SegmentedControl.Item value="warn">Warnings</SegmentedControl.Item>
          <SegmentedControl.Item value="error">Errors</SegmentedControl.Item>
        </SegmentedControl.Root>

        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={() => {
            void getElectronAPI()?.clearEmbeddedServerLogs(serverId);
            setLines([]);
          }}
        >
          <PiTrashFill size={14} />
          Clear
        </Button>
      </Flex>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        style={{
          height: 320,
          overflowY: "auto",
          background: "var(--gray-2)",
          border: "1px solid var(--gray-5)",
          borderRadius: "var(--radius-3)",
          padding: "8px 10px",
          fontFamily: "var(--code-font-family, monospace)",
          fontSize: 11,
          lineHeight: 1.55,
        }}
      >
        {visible.length === 0 ? (
          <Text size="1" color="gray">
            {lines.length === 0
              ? "Nothing yet. Start the server and its output shows up here."
              : "Nothing at this level from this source."}
          </Text>
        ) : (
          visible.map((l, i) => (
            <Flex key={`${l.at}-${i}`} gap="2" align="start">
              <Badge
                size="1"
                variant="soft"
                color={LEVEL_COLOR[l.level]}
                style={{ flexShrink: 0, minWidth: 62, justifyContent: "center" }}
              >
                {SOURCE_LABEL[l.source]}
              </Badge>
              <span
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color:
                    l.level === "error"
                      ? "var(--red-11)"
                      : l.level === "warn"
                        ? "var(--amber-11)"
                        : "var(--gray-12)",
                }}
              >
                {l.text}
              </span>
            </Flex>
          ))
        )}
      </div>
    </Flex>
  );
}
