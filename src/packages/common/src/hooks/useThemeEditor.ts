import type { GrytTheme } from "@gryt/ui";
import { useCallback, useState } from "react";

import { singletonHook } from "./singletonHook";

/**
 * The theme being edited right now, over the top of the running app. Not part of
 * `useCustomThemes`: a draft must not be written to disk on every frame.
 */

export interface ThemeEditorState {
  open: boolean;
  /** Null unless the panel is open. What the app should render when it is not. */
  draft: GrytTheme | null;
  /** The theme the panel opened on, for Revert. */
  openedWith: GrytTheme | null;
  openEditor: (from: GrytTheme) => void;
  closeEditor: () => void;
  setDraft: (theme: GrytTheme) => void;
  revert: () => void;
}

const initial: ThemeEditorState = {
  open: false,
  draft: null,
  openedWith: null,
  openEditor: () => {},
  closeEditor: () => {},
  setDraft: () => {},
  revert: () => {}
};

function useThemeEditorImpl(): ThemeEditorState {
  const [draft, setDraftState] = useState<GrytTheme | null>(null);
  const [openedWith, setOpenedWith] = useState<GrytTheme | null>(null);

  const openEditor = useCallback((from: GrytTheme) => {
    setOpenedWith(from);
    setDraftState(from);
  }, []);

  const closeEditor = useCallback(() => {
    setDraftState(null);
    setOpenedWith(null);
  }, []);

  const revert = useCallback(() => {
    setDraftState(openedWith);
  }, [openedWith]);

  return {
    open: draft !== null,
    draft,
    openedWith,
    openEditor,
    closeEditor,
    setDraft: setDraftState,
    revert
  };
}

export const useThemeEditor = singletonHook(initial, useThemeEditorImpl);
