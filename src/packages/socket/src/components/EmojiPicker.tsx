import { createGrytTheme, EmojiPicker as GrytEmojiPicker, type EmojiPickerGroup, type EmojiPickerItem, GrytProvider, grytTheme, grytThemeToOptions } from "@gryt/ui";
import { AirplaneTilt, Clock, Flag, ForkKnife, HandWaving, Heart, type Icon, Lightbulb, PawPrint, Smiley, SoccerBall, Sparkle } from "@phosphor-icons/react";
import { createElement, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useCustomThemes, useTheme } from "@/common";

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

/** What a pick sends: `:name:` for this server's own, the raw value for another's, else the character. */
function pickedText(item: EmojiPickerItem): string {
  if (item.id.startsWith("server:")) return `:${item.id.slice(7)}:`;
  return item.id.startsWith("other:") ? item.id.slice(6) : item.emoji ?? "";
}

function pickerItem(entry: EmojiEntry): EmojiPickerItem {
  const name = /^[+-]\d+$/.test(entry.name) ? entry.aliases[0] ?? entry.name : entry.name;
  return { id: entry.isCustom ? `server:${entry.name}` : `unicode:${entry.emoji}`, name,
    emoji: entry.emoji ?? undefined, imageUrl: entry.isCustom ? entry.url : undefined,
    keywords: [entry.name, ...entry.aliases, ...entry.tags] };
}

/* Icons for the rail: the standard categories, this server and the recent list (GRYT-1725). */
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
const icon = (id: string) => createElement(CATEGORY_ICONS[id] ?? Smiley, { size: 20, weight: "bold" });

export function EmojiPickerContent({ onSelect, serverHost, withOtherServers = false, autoFocusSearch = true }: EmojiPickerContentProps) {
  const custom = useSyncExternalStore(onCustomEmojisChange, () => getCustomEmojis(serverHost));
  const allowed = useExternalEmojisAllowed(serverHost);
  const others = useMemo(() => (withOtherServers && allowed ? getOtherServersEmojis(serverHost) : []), [withOtherServers, allowed, serverHost, custom]); // eslint-disable-line react-hooks/exhaustive-deps
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
      { id: "server", label: "This server", icon: icon("server"), items: custom.map(pickerItem) },
      { id: "recent", label: "Recently used", icon: icon("recent"), items: recent },
      ...others.map(([host, entries]) => ({
        id: `other:${host}`,
        label: host,
        icon: icon("server"),
        items: entries.map((e) => ({ ...pickerItem(e), id: `other:${externalEmojiMarkdown(e)}` })),
      })),
      ...Array.from(standard, ([label, entries]) => ({ id: label, label: SECTION_LABELS[label] ?? label, icon: icon(label), items: entries.map(pickerItem) })),
    ];
  }, [custom, serverHost, others]);
  return (
    <GrytProvider theme={theme} className="min-h-0 w-full">
      <GrytEmojiPicker
        groups={groups}
        autoFocus={autoFocusSearch}
        className="max-w-none"
        onKeyDown={(event) => { if (event.target instanceof HTMLInputElement) event.stopPropagation(); }}
        onSelect={(item) => onSelect(pickedText(item))}
      />
    </GrytProvider>
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
