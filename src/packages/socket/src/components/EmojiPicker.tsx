import type { EmojiPickerItem } from "@gryt/ui";
import { AirplaneTilt, Clock, Flag, ForkKnife, HandWaving, Heart, type Icon, Lightbulb, MagnifyingGlass, PawPrint, Smiley, SoccerBall, Sparkle, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { type EmojiEntry, externalEmojiMarkdown, getCustomEmojis, getOtherServersEmojis, getStandardEmojisByCategory, onCustomEmojisChange } from "../utils/emojiData";
import { useExternalEmojisAllowed } from "../utils/externalEmojiPolicy";
import { getRecentReactions } from "../utils/recentReactions";

interface EmojiPickerProps {
  onSelect: (reactionSrc: string) => void;
  onClose: () => void;
  anchorEl?: HTMLElement | null;
  placement?: "above" | "beside";
  serverHost?: string;
  /** Offers other servers' emoji where this one allows them. Not for reactions, which go by name. */
  withOtherServers?: boolean;
}

export interface EmojiPickerContentProps {
  onSelect: (reactionSrc: string) => void;
  serverHost?: string;
  withOtherServers?: boolean;
  autoFocusSearch?: boolean;
}

const PICKER_WIDTH = 440;
const PICKER_MAX_HEIGHT = 520;
const VIEWPORT_PAD = 8;
const GAP = 6;

function pickerItem(entry: EmojiEntry): EmojiPickerItem {
  const name = /^[+-]\d+$/.test(entry.name) ? entry.aliases[0] ?? entry.name : entry.name;
  return { id: entry.isCustom ? `server:${entry.name}` : `unicode:${entry.emoji}`, name,
    emoji: entry.emoji ?? undefined, imageUrl: entry.isCustom ? entry.url : undefined,
    keywords: [entry.name, ...entry.aliases, ...entry.tags] };
}

/* The category rail, in the order the sections are drawn (GRYT-1722 drafts). */
const CATEGORY_ICONS: Record<string, Icon> = {
  server: Sparkle,
  recent: Clock,
  "Smileys & Emotion": Smiley,
  "People & Body": HandWaving,
  "Animals & Nature": PawPrint,
  "Food & Drink": ForkKnife,
  "Activities": SoccerBall,
  "Travel & Places": AirplaneTilt,
  "Objects": Lightbulb,
  "Symbols": Heart,
  "Flags": Flag,
};
const SECTION_LABELS: Record<string, string> = { "Smileys & Emotion": "Smileys", "People & Body": "People" };
const COLUMNS = 8;
const CELL = 44;

interface Section { id: string; label: string; items: EmojiPickerItem[] }

function Cell({ item, active, onPick, onPoint }: { item: EmojiPickerItem; active: boolean; onPick: () => void; onPoint: () => void }) {
  return (
    <button type="button" aria-label={item.name} title={`:${item.name}:`} onClick={onPick} onMouseEnter={onPoint} onFocus={onPoint}
      style={{ width: CELL, height: CELL, padding: 0, border: "none", borderRadius: 10, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, lineHeight: 1,
        background: active ? "var(--gryt-neutral-5)" : "transparent" }}>
      {item.imageUrl
        ? <img src={item.imageUrl} alt="" draggable={false} style={{ width: 28, height: 28, objectFit: "contain" }} />
        : item.emoji}
    </button>
  );
}

export function EmojiPickerContent({ onSelect, serverHost, withOtherServers = false, autoFocusSearch = true }: EmojiPickerContentProps) {
  const custom = useSyncExternalStore(onCustomEmojisChange, () => getCustomEmojis(serverHost));
  const allowed = useExternalEmojisAllowed(serverHost);
  const others = useMemo(() => (withOtherServers && allowed ? getOtherServersEmojis(serverHost) : []), [withOtherServers, allowed, serverHost, custom]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo((): Section[] => {
    const standard = getStandardEmojisByCategory();
    const all = [...custom, ...Array.from(standard.values()).flat()];
    const recent = getRecentReactions(16, serverHost).flatMap((src) => {
      const entry = all.find((item) => item.isCustom ? src === `:${item.name}:` : src === item.emoji);
      return entry ? [pickerItem(entry)] : [];
    });
    return [
      { id: "server", label: "This server", items: custom.map(pickerItem) },
      { id: "recent", label: "Recently used", items: recent },
      ...others.map(([host, entries]) => ({
        id: `other:${host}`,
        label: host,
        items: entries.map((e) => ({ ...pickerItem(e), id: `other:${externalEmojiMarkdown(e)}` })),
      })),
      ...Array.from(standard, ([label, entries]) => ({ id: label, label: SECTION_LABELS[label] ?? label, items: entries.map(pickerItem) })),
    ].filter((section) => section.items.length > 0);
  }, [custom, serverHost, others]);

  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return null;
    const seen = new Set<string>();
    return sections.flatMap((section) => section.items).filter((item) => {
      if (seen.has(item.id)) return false;
      const hit = item.name.toLowerCase().includes(q) || item.keywords?.some((k) => k.toLowerCase().includes(q));
      if (hit) seen.add(item.id);
      return hit;
    });
  }, [q, sections]);

  const [pointed, setPointed] = useState<{ item: EmojiPickerItem; from: string } | null>(null);
  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());

  const pick = (item: EmojiPickerItem) => onSelect(
    item.id.startsWith("server:") ? `:${item.id.slice(7)}:` : item.id.startsWith("other:") ? item.id.slice(6) : item.emoji ?? "",
  );
  const jump = (id: string) => {
    setQuery("");
    setCurrent(id);
    requestAnimationFrame(() => {
      const el = sectionRefs.current.get(id);
      if (el && scrollRef.current) scrollRef.current.scrollTop = el.offsetTop;
    });
  };
  // The rail follows the scroll: the last section whose top has passed.
  const onScroll = () => {
    const top = scrollRef.current?.scrollTop ?? 0;
    let at = sections[0]?.id ?? "";
    for (const section of sections) {
      const el = sectionRefs.current.get(section.id);
      if (el && el.offsetTop <= top + 8) at = section.id;
    }
    setCurrent(at);
  };

  const grid = (items: EmojiPickerItem[], from: string) => (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${COLUMNS}, ${CELL}px)` }}>
      {items.map((item) => (
        <Cell key={item.id} item={item} active={pointed?.item.id === item.id}
          onPick={() => pick(item)} onPoint={() => setPointed({ item, from })} />
      ))}
    </div>
  );
  const heading = (label: string) => (
    <div style={{ position: "sticky", top: 0, zIndex: 1, padding: "8px 4px 6px", background: "var(--gryt-neutral-2)",
      fontSize: 12, fontWeight: 700, letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--gryt-neutral-11)" }}>
      {label}
    </div>
  );
  const preview = pointed ?? (results?.[0] ? { item: results[0], from: "" } : null);
  const fromLabel = (item: EmojiPickerItem, from: string) =>
    item.id.startsWith("server:") ? "From this server" : item.id.startsWith("other:") ? `From ${from}` : sections.find((s) => s.id === from)?.label ?? "";

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0,
      background: "var(--gryt-neutral-2)", border: "1px solid var(--gryt-neutral-6)", borderRadius: 16,
      boxShadow: "0 18px 48px rgba(0, 0, 0, 0.6)", overflow: "hidden", color: "var(--gryt-neutral-12)" }}>
      <div style={{ padding: 12, borderBottom: "1px solid var(--gryt-neutral-6)", flex: "none" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 12px", borderRadius: 10,
          background: "var(--gryt-neutral-1)", border: `1px solid ${q ? "var(--gryt-accent-9)" : "var(--gryt-neutral-6)"}` }}>
          <MagnifyingGlass size={16} weight="bold" color="var(--gryt-neutral-11)" />
          <input
            autoFocus={autoFocusSearch}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPointed(null); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && results?.[0]) { e.preventDefault(); pick(results[0]); }
            }}
            placeholder="Search emoji"
            aria-label="Search emoji"
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "inherit", font: "inherit", fontSize: 15 }}
          />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}
              style={{ display: "flex", padding: 0, border: "none", background: "none", cursor: "pointer", color: "var(--gryt-neutral-11)" }}>
              <X size={14} weight="bold" />
            </button>
          )}
        </label>
      </div>
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div role="tablist" aria-label="Categories" style={{ display: "flex", flexDirection: "column", gap: 2, padding: "8px 6px",
          borderRight: "1px solid var(--gryt-neutral-6)", overflowY: "auto", flex: "none", opacity: q ? 0.45 : 1 }}>
          {sections.filter((s) => !s.id.startsWith("other:")).map((section) => {
            const Glyph = CATEGORY_ICONS[section.id] ?? Smiley;
            const on = !q && current === section.id;
            return (
              <button key={section.id} type="button" role="tab" aria-selected={on} aria-label={section.label} title={section.label}
                onClick={() => jump(section.id)}
                style={{ width: 34, height: 34, flex: "none", padding: 0, border: "none", borderRadius: 10, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: on ? "var(--gryt-accent-4)" : "transparent", color: on ? "var(--gryt-accent-11)" : "var(--gryt-neutral-11)" }}>
                <Glyph size={20} weight="bold" />
              </button>
            );
          })}
        </div>
        <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "0 8px 6px" }}>
          {results ? (
            <div>
              {heading(`Results for “${query.trim()}”`)}
              {results.length > 0 ? grid(results, "") : (
                <p style={{ margin: "16px 4px", fontSize: 14, color: "var(--gryt-neutral-11)" }}>No emoji called that.</p>
              )}
            </div>
          ) : sections.map((section) => (
            <div key={section.id} ref={(el) => { if (el) sectionRefs.current.set(section.id, el); else sectionRefs.current.delete(section.id); }}>
              {heading(section.label)}
              {grid(section.items, section.id)}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, height: 56, padding: "0 14px", flex: "none",
        borderTop: "1px solid var(--gryt-neutral-6)" }}>
        {preview ? (
          <>
            <span style={{ width: 36, display: "flex", justifyContent: "center", fontSize: 32, lineHeight: 1 }}>
              {preview.item.imageUrl
                ? <img src={preview.item.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: "contain" }} />
                : preview.item.emoji}
            </span>
            <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>:{preview.item.name}:</span>
              <span style={{ fontSize: 13, color: "var(--gryt-neutral-11)" }}>{fromLabel(preview.item, preview.from)}</span>
            </span>
          </>
        ) : (
          <span style={{ fontSize: 13, color: "var(--gryt-neutral-11)" }}>Point at an emoji to see its name.</span>
        )}
      </div>
    </div>
  );
}

export const EmojiPicker = ({ onSelect, onClose, anchorEl, placement = "above", serverHost, withOtherServers }: EmojiPickerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fixedPos, setFixedPos] = useState<{ top?: number; bottom?: number; left: number }>({ left: 0 });
  useLayoutEffect(() => {
    const anchor = anchorEl ?? containerRef.current?.parentElement;
    if (!(anchor instanceof HTMLElement)) return;
    const compute = () => {
      const rect = anchor.getBoundingClientRect();
      if (placement === "beside") {
        let top = rect.top;
        if (top + PICKER_MAX_HEIGHT > window.innerHeight - VIEWPORT_PAD) top = window.innerHeight - PICKER_MAX_HEIGHT - VIEWPORT_PAD;
        if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
        const right = window.innerWidth - rect.right - VIEWPORT_PAD;
        const leftSpace = rect.left - VIEWPORT_PAD;
        let left: number;
        if (right >= PICKER_WIDTH + GAP) left = rect.right + GAP;
        else if (leftSpace >= PICKER_WIDTH + GAP) left = rect.left - PICKER_WIDTH - GAP;
        else {
          left = rect.left + rect.width / 2 - PICKER_WIDTH / 2;
          if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
          if (left + PICKER_WIDTH > window.innerWidth - VIEWPORT_PAD) left = window.innerWidth - PICKER_WIDTH - VIEWPORT_PAD;
        }
        setFixedPos({ top, bottom: undefined, left });
      } else {
        const above = rect.top;
        const below = window.innerHeight - rect.bottom;
        const useAbove = above >= PICKER_MAX_HEIGHT || above >= below;
        let left = rect.right - PICKER_WIDTH;
        if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
        if (left + PICKER_WIDTH > window.innerWidth - VIEWPORT_PAD) left = window.innerWidth - PICKER_WIDTH - VIEWPORT_PAD;
        setFixedPos({ top: useAbove ? undefined : rect.bottom + GAP,
          bottom: useAbove ? window.innerHeight - rect.top + GAP : undefined, left });
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
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [onClose]);
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onClose();
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", outside), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", outside);
    };
  }, [onClose]);
  const select = useCallback((src: string) => { onSelect(src); onClose(); }, [onSelect, onClose]);
  return (
    <div ref={containerRef} style={{ position: "fixed", ...fixedPos, width: PICKER_WIDTH, maxWidth: "calc(100vw - 16px)",
      height: PICKER_MAX_HEIGHT, maxHeight: "calc(100vh - 16px)", display: "flex", flexDirection: "column", zIndex: "var(--gryt-z-popover)" }}
      onMouseDown={(event) => event.stopPropagation()}>
      <EmojiPickerContent onSelect={select} serverHost={serverHost} withOtherServers={withOtherServers} />
    </div>
  );
};
