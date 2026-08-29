import type { GrytTheme } from "@gryt/ui";
import { useCallback, useState } from "react";

import { singletonHook } from "./singletonHook";

/**
 * The theme being edited right now, over the top of the running app.
 *
 * A theme used to be built on ui.gryt.chat and carried here as a link, which
 * meant the one question worth asking — does this colour survive a member
 * list, a voice tile, a mention — could not be asked until after it was saved.
 * The editor is a panel over the app now, and this is the draft it edits.
 *
 * Deliberately not part of `useCustomThemes`. What that hook holds is written
 * to localStorage; a draft is a colour somebody is dragging a slider through
 * and has not decided about, and writing every frame of that to disk would
 * turn an experiment into a saved theme nobody asked for. A draft lives for as
 * long as the panel is open and then it is gone unless it was saved.
 *
 * `openedWith` is what Revert goes back to. Live editing with no way back is a
 * theme you can wreck with one drag, and "close without saving" is not the
 * same offer — somebody who has made four good changes and one bad one wants
 * the bad one gone, not all five.
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
