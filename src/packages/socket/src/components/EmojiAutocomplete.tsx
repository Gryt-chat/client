import { useCallback, useEffect, useRef, useState } from "react";

import { type EmojiEntry,searchEmojis } from "../utils/emojiData";

interface EmojiAutocompleteProps {
  query: string;
  visible: boolean;
  onSelect: (entry: EmojiEntry) => void;
  onClose: () => void;
}

export const EmojiAutocomplete = ({ query, visible, onSelect, onClose }: EmojiAutocompleteProps) => {
  const [results, setResults] = useState<EmojiEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible || !query) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    const matched = searchEmojis(query, 8);
    setResults(matched);
    setSelectedIndex(0);
  }, [query, visible]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!visible || results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + results.length) % results.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        onSelect(results[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [visible, results, selectedIndex, onSelect, onClose],
  );

  useEffect(() => {
    if (!visible) return;
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [visible, handleKeyDown]);

  useEffect(() => {
    const el = containerRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!visible || results.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="emoji-autocomplete"
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        right: 0,
        marginBottom: "4px",
        background: "var(--color-panel-solid)",
        border: "1px solid var(--gray-6)",
        borderRadius: "10px",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
        maxHeight: "280px",
        overflowY: "auto",
        zIndex: 100,
        padding: "4px",
      }}
    >
      {results.map((entry, idx) => (
        <div
          key={`${entry.isCustom ? "c:" : ""}${entry.name}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(entry);
          }}
          onMouseEnter={() => setSelectedIndex(idx)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "6px 10px",
            borderRadius: "6px",
            cursor: "pointer",
            background: idx === selectedIndex ? "var(--gray-4)" : "transparent",
            transition: "background 0.1s ease",
            fontSize: "14px",
          }}
        >
          <span
            style={{
              width: "24px",
              height: "24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              fontSize: "20px",
            }}
          >
            {entry.emoji ? (
              entry.emoji
            ) : entry.url ? (
              <img
                src={entry.url}
                alt={entry.name}
                style={{ width: "24px", height: "24px", objectFit: "contain" }}
              />
            ) : null}
          </span>
          <span style={{ color: "var(--gray-12)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            :{entry.name}:
          </span>
          {entry.isCustom && (
            <span
              style={{
                fontSize: "10px",
                color: "var(--gray-9)",
                background: "var(--gray-3)",
                padding: "1px 5px",
                borderRadius: "4px",
                flexShrink: 0,
              }}
            >
              custom
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
