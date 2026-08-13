import type { GrytTheme } from "@gryt/ui";
import { decodeGrytTheme } from "@gryt/ui";
import { useCallback, useState } from "react";

import { singletonHook } from "./singletonHook";

/**
 * Themes somebody brought with them.
 *
 * A Gryt theme is a couple of dozen hex values, which is small enough to fit in
 * a link — that is what the generator on ui.gryt.chat produces, and what this
 * keeps. The palette itself is not stored as CSS: a theme is the anchors, and
 * createGrytTheme regenerates the twelve-step scales from them, so a theme
 * saved today still gets whatever the scales learn to do later.
 *
 * Not the addon system. Addons are files on disk with a manifest, loaded by
 * Electron, and asking somebody to write one to change their colours was the
 * gap this fills. If the two should meet — a saved theme written out as a theme
 * addon — that is a button, not a different design.
 */

const THEMES_KEY = "theme.custom.themes";
const ACTIVE_KEY = "theme.custom.active";

export interface SavedTheme {
  id: string;
  name: string;
  theme: GrytTheme;
  /** Epoch millis, so the list can stay in the order they arrived. */
  savedAt: number;
}

function readThemes(): SavedTheme[] {
  const raw = localStorage.getItem(THEMES_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Each theme goes back through the library's parser rather than being
    // trusted as-is. localStorage is editable, an old entry may predate a key,
    // and a half-valid theme applied to the whole app is worse than one that
    // is quietly dropped.
    return parsed.flatMap((entry: unknown) => {
      if (typeof entry !== "object" || entry === null) return [];
      const row = entry as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.name !== "string") return [];
      const decoded = decodeGrytTheme(JSON.stringify(row.theme));
      if (decoded === null) return [];
      return [
        {
          id: row.id,
          name: row.name,
          theme: decoded.theme,
          savedAt: typeof row.savedAt === "number" ? row.savedAt : 0
        }
      ];
    });
  } catch {
    return [];
  }
}

function writeThemes(themes: SavedTheme[]) {
  localStorage.setItem(THEMES_KEY, JSON.stringify(themes));
}

function newId(): string {
  return `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface CustomThemesState {
  themes: SavedTheme[];
  /** Null means the palette the library ships, which is not in the list. */
  activeId: string | null;
  activeTheme: GrytTheme | null;
  saveTheme: (name: string, theme: GrytTheme) => string;
  renameTheme: (id: string, name: string) => void;
  deleteTheme: (id: string) => void;
  setActiveTheme: (id: string | null) => void;
}

const initial: CustomThemesState = {
  themes: [],
  activeId: null,
  activeTheme: null,
  saveTheme: () => "",
  renameTheme: () => {},
  deleteTheme: () => {},
  setActiveTheme: () => {}
};

function useCustomThemesImpl(): CustomThemesState {
  const [themes, setThemes] = useState<SavedTheme[]>(readThemes);
  const [activeId, setActiveId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_KEY)
  );

  const persist = useCallback((next: SavedTheme[]) => {
    writeThemes(next);
    setThemes(next);
  }, []);

  const setActiveTheme = useCallback((id: string | null) => {
    setActiveId(id);
    if (id === null) localStorage.removeItem(ACTIVE_KEY);
    else localStorage.setItem(ACTIVE_KEY, id);
  }, []);

  const saveTheme = useCallback(
    (name: string, theme: GrytTheme) => {
      const id = newId();
      const trimmed = name.trim();
      const label = trimmed === "" ? "Imported theme" : trimmed;
      persist([
        ...readThemes(),
        {
          id,
          name: label,
          // The name goes into the document as well as beside it, so a link
          // copied back out of here carries what this install calls it rather
          // than what it was called when it arrived.
          theme: { ...theme, name: label },
          savedAt: Date.now()
        }
      ]);
      // Saving one and not seeing it is a click nobody wants to make twice.
      setActiveTheme(id);
      return id;
    },
    [persist, setActiveTheme]
  );

  const renameTheme = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed === "") return;
      persist(
        readThemes().map((entry) =>
          entry.id === id
            ? { ...entry, name: trimmed, theme: { ...entry.theme, name: trimmed } }
            : entry
        )
      );
    },
    [persist]
  );

  const deleteTheme = useCallback(
    (id: string) => {
      persist(readThemes().filter((entry) => entry.id !== id));
      // Deleting the one in use falls back to Gryt's rather than leaving the
      // app pointed at something that is no longer there.
      setActiveId((current) => {
        if (current !== id) return current;
        localStorage.removeItem(ACTIVE_KEY);
        return null;
      });
    },
    [persist]
  );

  const activeTheme =
    themes.find((entry) => entry.id === activeId)?.theme ?? null;

  return {
    themes,
    activeId: activeTheme === null ? null : activeId,
    activeTheme,
    saveTheme,
    renameTheme,
    deleteTheme,
    setActiveTheme
  };
}

export const useCustomThemes = singletonHook(initial, useCustomThemesImpl);
