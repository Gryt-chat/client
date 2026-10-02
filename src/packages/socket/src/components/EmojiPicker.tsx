import { createGrytTheme, EmojiPicker as GrytEmojiPicker, type EmojiPickerGroup, type EmojiPickerItem, GrytProvider, grytTheme, grytThemeToOptions } from "@gryt/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useCustomThemes, useTheme } from "@/common";

import { type EmojiEntry, getCustomEmojis, getStandardEmojisByCategory, onCustomEmojisChange } from "../utils/emojiData";
import { getRecentReactions } from "../utils/recentReactions";

interface EmojiPickerProps {
  onSelect: (reactionSrc: string) => void;
  onClose: () => void;
  anchorEl?: HTMLElement | null;
  placement?: "above" | "beside";
  serverHost?: string;
}

export interface EmojiPickerContentProps {
  onSelect: (reactionSrc: string) => void;
  serverHost?: string;
  autoFocusSearch?: boolean;
}

const PICKER_WIDTH = 340;
const PICKER_MAX_HEIGHT = 400;
const VIEWPORT_PAD = 8;
const GAP = 6;

function pickerItem(entry: EmojiEntry): EmojiPickerItem {
  const name = /^[+-]\d+$/.test(entry.name) ? entry.aliases[0] ?? entry.name : entry.name;
  return { id: entry.isCustom ? `server:${entry.name}` : `unicode:${entry.emoji}`, name,
    emoji: entry.emoji ?? undefined, imageUrl: entry.isCustom ? entry.url : undefined,
    keywords: [entry.name, ...entry.aliases, ...entry.tags] };
}

export function EmojiPickerContent({ onSelect, serverHost, autoFocusSearch = true }: EmojiPickerContentProps) {
  const custom = useSyncExternalStore(onCustomEmojisChange, () => getCustomEmojis(serverHost));
  const { activeTheme } = useCustomThemes();
  const { resolvedAppearance } = useTheme();
  const theme = useMemo(() => createGrytTheme(grytThemeToOptions(activeTheme ?? grytTheme, resolvedAppearance)), [activeTheme, resolvedAppearance]);
  const groups = useMemo((): EmojiPickerGroup[] => {
    const standard = getStandardEmojisByCategory();
    const all = [...custom, ...Array.from(standard.values()).flat()];
    const recent = getRecentReactions(16, serverHost).flatMap((src) => {
      const entry = all.find((item) => item.isCustom ? src === `:${item.name}:` : src === item.emoji);
      return entry ? [pickerItem(entry)] : [];
    });
    return [
      { id: "server", label: "This server", items: custom.map(pickerItem) },
      { id: "recent", label: "Recently Used", items: recent },
      ...Array.from(standard, ([label, entries]) => ({ id: label, label, items: entries.map(pickerItem) })),
    ];
  }, [custom, serverHost]);
  return (
    <GrytProvider theme={theme} className="min-h-0 w-full">
      <GrytEmojiPicker
        groups={groups}
        autoFocus={autoFocusSearch}
        searchPlaceholder="Search emojis..."
        className="max-w-none"
        onKeyDown={(event) => { if (event.target instanceof HTMLInputElement) event.stopPropagation(); }}
        onSelect={(item) => onSelect(item.id.startsWith("server:") ? `:${item.id.slice(7)}:` : item.emoji ?? "")}
      />
    </GrytProvider>
  );
}

export const EmojiPicker = ({ onSelect, onClose, anchorEl, placement = "above", serverHost }: EmojiPickerProps) => {
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
      maxHeight: PICKER_MAX_HEIGHT, display: "flex", flexDirection: "column", zIndex: "var(--gryt-z-popover)" }}
      onMouseDown={(event) => event.stopPropagation()}>
      <EmojiPickerContent onSelect={select} serverHost={serverHost} />
    </div>
  );
};
