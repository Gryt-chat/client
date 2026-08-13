import { Button, Chip, Tabs } from "@gryt/ui";
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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={source} onValueChange={(v) => setSource(v as EmbeddedLogSource | "all")}>
          <Tabs.List aria-label="source">
          <Tabs.Tab value="all">All</Tabs.Tab>
          <Tabs.Tab value="server">Server</Tabs.Tab>
          <Tabs.Tab value="sfu">SFU</Tabs.Tab>
          <Tabs.Tab value="worker">Worker</Tabs.Tab>
        <Tabs.Indicator />
        </Tabs.List>
        </Tabs>

        <Tabs value={level} onValueChange={(v) => setLevel(v as keyof typeof LEVEL_RANK)}>
          <Tabs.List aria-label="level">
          <Tabs.Tab value="debug">Debug</Tabs.Tab>
          <Tabs.Tab value="info">Info</Tabs.Tab>
          <Tabs.Tab value="warn">Warnings</Tabs.Tab>
          <Tabs.Tab value="error">Errors</Tabs.Tab>
        <Tabs.Indicator />
        </Tabs.List>
        </Tabs>

        <Button tone="neutral" size="xsmall"
          onClick={() => {
            void getElectronAPI()?.clearEmbeddedServerLogs(serverId);
            setLines([]);
          }}
        >
          <PiTrashFill size={14} />
          Clear
        </Button>
      </div>

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
          background: "var(--gryt-neutral-2)",
          border: "1px solid var(--gryt-neutral-5)",
          borderRadius: "var(--gryt-radius-md)",
          padding: "8px 10px",
          fontFamily: "var(--code-font-family, monospace)",
          fontSize: 11,
          lineHeight: 1.55,
        }}
      >
        {visible.length === 0 ? (
          <span className="text-xs text-gryt-muted">
            {lines.length === 0
              ? "Nothing yet. Start the server and its output shows up here."
              : "Nothing at this level from this source."}
          </span>
        ) : (
          visible.map((l, i) => (
            <div className="flex gap-2 items-start" key={`${l.at}-${i}`}>
              <Chip tone="neutral"
                color={LEVEL_COLOR[l.level]}
                style={{ flexShrink: 0, minWidth: 62, justifyContent: "center" }}
              >
                {SOURCE_LABEL[l.source]}
              </Chip>
              <span
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color:
                    l.level === "error"
                      ? "var(--gryt-danger-11)"
                      : l.level === "warn"
                        ? "var(--gryt-warning-11)"
                        : "var(--gryt-neutral-12)",
                }}
              >
                {l.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
