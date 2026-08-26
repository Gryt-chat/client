import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** Matches the Windows Snap Layouts dwell, which is the habit people have. */
export const HOVER_OPEN_MS = 500;

/** Long enough to cross the gap from the button to the menu. */
const HOVER_CLOSE_MS = 220;

/**
 * Open on dwell, close on leaving either the button or the menu.
 *
 * The grace period on the way out is what makes the gap between the two
 * crossable; without it the menu closes under the pointer on its way there.
 *
 * Every callback is stable, because the object this returns is a dependency of
 * effects in both control sets — rebuilt each render, it would re-run them on
 * every render of the titlebar.
 */
export function useSnapMenu() {
  const [open, setOpen] = useState(false);
  const [openedByKeyboard, setOpenedByKeyboard] =
    useState(false);
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const openNow = useCallback(() => {
    clear();
    setOpen(true);
  }, [clear]);

  const openAfterDwell = useCallback(() => {
    clear();
    timer.current = window.setTimeout(() => {
      setOpenedByKeyboard(false);
      setOpen(true);
    }, HOVER_OPEN_MS);
  }, [clear]);

  const openByKeyboard = useCallback(() => {
    clear();
    setOpenedByKeyboard(true);
    setOpen(true);
  }, [clear]);

  const closeAfterGrace = useCallback(() => {
    clear();
    timer.current = window.setTimeout(
      () => setOpen(false),
      HOVER_CLOSE_MS
    );
  }, [clear]);

  const closeNow = useCallback(() => {
    clear();
    setOpen(false);
    setOpenedByKeyboard(false);
  }, [clear]);

  return useMemo(
    () => ({
      open,
      openedByKeyboard,
      openNow,
      openAfterDwell,
      openByKeyboard,
      closeAfterGrace,
      closeNow,
    }),
    [
      open,
      openedByKeyboard,
      openNow,
      openAfterDwell,
      openByKeyboard,
      closeAfterGrace,
      closeNow,
    ]
  );
}
