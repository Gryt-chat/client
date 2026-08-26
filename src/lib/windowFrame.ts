import { useEffect, useState } from "react";

import type { WindowState } from "./electron";
import { isElectron } from "./electron";

/**
 * The window frame, which the app draws itself on every platform (GRYT-626).
 *
 * The window is frameless and transparent, so nothing outside what the
 * renderer paints exists. The radius, the hairline border and the buttons in
 * the titlebar are all ours, and they are the same on macOS, Windows and
 * Linux — which is the whole point of doing it this way, since no OS lets
 * anyone set its own corner radius.
 */

/** macOS puts the window buttons on the left. Everywhere else, the right. */
export function isMacOS(): boolean {
  return window.electronAPI?.platform === "darwin";
}

const SQUARE: WindowState = {
  maximized: false,
  fullScreen: false,
  flush: false,
};

/**
 * Whether the window is currently at an edge of the screen.
 *
 * Read once on mount and then pushed from main on every transition. Polling
 * would be wrong as well as wasteful: a maximise is instant and the frame has
 * to square off in the same frame the window changes shape, or the corners
 * flash the desktop.
 */
export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>(SQUARE);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onWindowStateChange) return;

    let live = true;
    api.getWindowState().then((s) => {
      if (live) setState(s);
    });

    const stop = api.onWindowStateChange(setState);
    return () => {
      live = false;
      stop();
    };
  }, []);

  return state;
}

/** Whether the window has focus. The border dims when it does not, as macOS's own does. */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onWindowFocusChange) return;
    return api.onWindowFocusChange(setFocused);
  }, []);

  return focused;
}

/**
 * Puts the frame's state where the stylesheet can reach it.
 *
 * On the root element rather than on .gryt-app, for the reason the appearance
 * class and the zoom are there: every dialog, menu and tooltip portals to
 * document.body, so anything lower is invisible to half the app.
 */
export function useWindowFrame(): void {
  const { flush } = useWindowState();
  const focused = useWindowFocused();
  const framed = isElectron();

  useEffect(() => {
    const root = document.documentElement;
    if (!framed) {
      root.removeAttribute("data-gryt-frame");
      return;
    }

    /* Square only while the window is genuinely covering its display: there
       is nothing behind it there to fill a curve, so a rounded corner would
       be a notch. Everywhere else — snapped to a half, resized by hand,
       dragged out of a maximised state — it stays round. */
    root.setAttribute(
      "data-gryt-frame",
      flush ? "flush" : "floating"
    );
    root.toggleAttribute("data-gryt-window-blurred", !focused);

    return () => {
      root.removeAttribute("data-gryt-frame");
      root.removeAttribute("data-gryt-window-blurred");
    };
  }, [framed, flush, focused]);
}
