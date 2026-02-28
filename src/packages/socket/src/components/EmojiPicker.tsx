import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  type EmojiEntry,
  getCustomEmojis,
  getStandardEmojisByCategory,
  onCustomEmojisChange,
  searchEmojis,
} from "../utils/emojiData";
import { getRecentReactions } from "../utils/recentReactions";

interface EmojiPickerProps {
  onSelect: (reactionSrc: string) => void;
  onClose: () => void;
  anchorEl?: HTMLElement | null;
  placement?: "above" | "beside";
  serverHost?: string;
}

const CATEGORY_ICONS: Record<string, string> = {
  "Recently Used": "🕒",
  "Custom": "⭐",
  "Smileys & Emotion": "😀",
  "People & Body": "👋",
  "Animals & Nature": "🐾",
  "Food & Drink": "🍕",
  "Travel & Places": "✈️",
  "Activities": "⚽",
  "Objects": "💡",
  "Symbols": "💜",
  "Flags": "🏁",
};

const COLS = 8;

function EmojiCell({ entry, onSelect }: { entry: EmojiEntry; onSelect: (src: string) => void }) {
  const src = entry.isCustom ? `:${entry.name}:` : entry.emoji!;
  return (
    <button
      onClick={() => onSelect(src)}
      title={`:${entry.name}:`}
      style={{
        width: 36,
        height: 36,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 22,
        lineHeight: 1,
        padding: 0,
        transition: "background 0.12s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-4)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      {entry.emoji ? (
        entry.emoji
      ) : entry.url ? (
        <img
          src={entry.url}
          alt={entry.name}
          style={{ width: 22, height: 22, objectFit: "contain" }}
        />
      ) : null}
    </button>
  );
}

function CategorySection({
  label,
  entries,
  onSelect,
}: {
  label: string;
  entries: EmojiEntry[];
  onSelect: (src: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          background: "var(--color-panel-solid)",
          padding: "6px 6px 4px",
          margin: "0 -6px",
          fontSize: 12,
          fontWeight: 600,
          color: "var(--gray-10)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <span style={{ fontSize: 14 }}>{CATEGORY_ICONS[label] ?? ""}</span>
        {label}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 36px)`,
          gap: 2,
          padding: "0 2px",
        }}
      >
        {entries.map((entry, idx) => (
          <EmojiCell key={`${entry.isCustom ? "c:" : ""}${entry.name}-${idx}`} entry={entry} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

export const EmojiPicker = ({ onSelect, onClose, anchorEl, placement = "above", serverHost }: EmojiPickerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [fixedPos, setFixedPos] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });

  const PICKER_WIDTH = 340;
  const PICKER_MAX_HEIGHT = 400;
  const VIEWPORT_PAD = 8;
  const GAP = 6;

  useLayoutEffect(() => {
    const anchor = anchorEl ?? containerRef.current?.parentElement;
    if (!(anchor instanceof HTMLElement)) return;

    const compute = () => {
      const rect = anchor.getBoundingClientRect();

      if (placement === "beside") {
        let top: number = rect.top;
        if (top + PICKER_MAX_HEIGHT > window.innerHeight - VIEWPORT_PAD) {
          top = window.innerHeight - PICKER_MAX_HEIGHT - VIEWPORT_PAD;
        }
        if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;

        const spaceRight = window.innerWidth - rect.right - VIEWPORT_PAD;
        const spaceLeft = rect.left - VIEWPORT_PAD;
        let left: number;

        if (spaceRight >= PICKER_WIDTH + GAP) {
          left = rect.right + GAP;
        } else if (spaceLeft >= PICKER_WIDTH + GAP) {
          left = rect.left - PICKER_WIDTH - GAP;
        } else {
          left = rect.left + rect.width / 2 - PICKER_WIDTH / 2;
          if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
          if (left + PICKER_WIDTH > window.innerWidth - VIEWPORT_PAD) {
            left = window.innerWidth - PICKER_WIDTH - VIEWPORT_PAD;
          }
        }

        setFixedPos({ top, bottom: undefined, left });
      } else {
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        let top: number | undefined;
        let bottom: number | undefined;
        if (spaceAbove >= PICKER_MAX_HEIGHT || spaceAbove >= spaceBelow) {
          bottom = window.innerHeight - rect.top + GAP;
        } else {
          top = rect.bottom + GAP;
        }

        let left = rect.right - PICKER_WIDTH;
        if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
        if (left + PICKER_WIDTH > window.innerWidth - VIEWPORT_PAD) {
          left = window.innerWidth - PICKER_WIDTH - VIEWPORT_PAD;
        }

        setFixedPos({ top, bottom, left });
      }
    };

    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [anchorEl, placement]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [onClose]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  const recentEntries = useMemo((): EmojiEntry[] => {
    const recent = getRecentReactions(16, serverHost);
    const customEmojis = getCustomEmojis();
    const byCategory = getStandardEmojisByCategory();
    const allStandard: EmojiEntry[] = [];
    for (const entries of byCategory.values()) allStandard.push(...entries);

    return recent
      .map((src): EmojiEntry | null => {
        if (src.startsWith(":") && src.endsWith(":")) {
          const name = src.slice(1, -1);
          return customEmojis.find((e) => e.name === name) ?? null;
        }
        return allStandard.find((e) => e.emoji === src) ?? null;
      })
      .filter((e): e is EmojiEntry => e !== null);
  }, [serverHost]);

  const [customVersion, setCustomVersion] = useState(0);
  useEffect(() => onCustomEmojisChange(() => setCustomVersion((v) => v + 1)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const customEntries = useMemo(() => getCustomEmojis(), [customVersion]);
  const standardCategories = useMemo(() => getStandardEmojisByCategory(), []);

  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    return searchEmojis(search.trim());
  }, [search]);

  const handleSelect = useCallback(
    (src: string) => {
      onSelect(src);
      onClose();
    },
    [onSelect, onClose],
  );

  const categoryNames = useMemo(() => Array.from(standardCategories.keys()), [standardCategories]);

  const scrollToCategory = useCallback((category: string) => {
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-category="${CSS.escape(category)}"]`) as HTMLElement | null;
    if (!el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + elRect.top - containerRect.top,
      behavior: "smooth",
    });
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        top: fixedPos.top,
        bottom: fixedPos.bottom,
        left: fixedPos.left,
        width: PICKER_WIDTH,
        maxHeight: PICKER_MAX_HEIGHT,
        background: "var(--color-panel-solid)",
        border: "1px solid var(--gray-7)",
        borderRadius: 12,
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.3), 0 4px 8px rgba(0, 0, 0, 0.1)",
        display: "flex",
        flexDirection: "column",
        zIndex: 9999,
        overflow: "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Search */}
      <div style={{ padding: "8px 8px 4px" }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search emojis..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "6px 10px",
            border: "1px solid var(--gray-6)",
            borderRadius: 8,
            background: "var(--gray-2)",
            color: "var(--gray-12)",
            fontSize: 13,
            outline: "none",
            boxSizing: "border-box",
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent-8)"; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = "var(--gray-6)"; }}
        />
      </div>

      {/* Category nav */}
      {!searchResults && (
        <div
          style={{
            display: "flex",
            gap: 1,
            padding: "2px 6px 4px",
            borderBottom: "1px solid var(--gray-5)",
            overflowX: "auto",
            flexShrink: 0,
          }}
        >
          {recentEntries.length > 0 && (
            <NavButton icon={CATEGORY_ICONS["Recently Used"]} label="Recently Used" onClick={() => scrollToCategory("Recently Used")} />
          )}
          {customEntries.length > 0 && (
            <NavButton icon={CATEGORY_ICONS["Custom"]} label="Custom" onClick={() => scrollToCategory("Custom")} />
          )}
          {categoryNames.map((cat) => (
            <NavButton key={cat} icon={CATEGORY_ICONS[cat] ?? "?"} label={cat} onClick={() => scrollToCategory(cat)} />
          ))}
        </div>
      )}

      {/* Emoji grid */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "0 6px 8px" }}>
        {searchResults ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${COLS}, 36px)`,
              gap: 2,
              padding: "4px 2px",
            }}
          >
            {searchResults.map((entry, idx) => (
              <EmojiCell key={`${entry.isCustom ? "c:" : ""}${entry.name}-${idx}`} entry={entry} onSelect={handleSelect} />
            ))}
            {searchResults.length === 0 && (
              <div style={{ gridColumn: `1 / -1`, padding: 16, textAlign: "center", color: "var(--gray-9)", fontSize: 13 }}>
                No emojis found
              </div>
            )}
          </div>
        ) : (
          <>
            {recentEntries.length > 0 && (
              <div data-category="Recently Used">
                <CategorySection label="Recently Used" entries={recentEntries} onSelect={handleSelect} />
              </div>
            )}
            {customEntries.length > 0 && (
              <div data-category="Custom">
                <CategorySection label="Custom" entries={customEntries} onSelect={handleSelect} />
              </div>
            )}
            {categoryNames.map((cat) => (
              <div key={cat} data-category={cat}>
                <CategorySection label={cat} entries={standardCategories.get(cat) ?? []} onSelect={handleSelect} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

function NavButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        background: "none",
        border: "none",
        padding: "3px 5px",
        fontSize: 16,
        lineHeight: 1,
        borderRadius: 6,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.12s",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--gray-4)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      {icon}
    </button>
  );
}
