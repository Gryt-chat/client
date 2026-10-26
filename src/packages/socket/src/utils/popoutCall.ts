import { isElectron } from "../../../../lib/electron";

export interface CallWindow {
  title: string;
  container: HTMLElement;
  close: () => void;
}

interface DocumentPictureInPicture {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
}

const WIDTH = 480;
const HEIGHT = 300;

/** The app's stylesheets and theme variables, so the call looks the same in its own window. */
function copyLook(from: Document, to: Document) {
  for (const node of from.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    to.head.appendChild(node.cloneNode(true));
  }
  // A custom theme sets its variables on GrytProvider's element, not on :root.
  const themed = from.querySelector<HTMLElement>('[style*="--gryt-"]');
  if (themed) to.body.setAttribute("style", themed.getAttribute("style") ?? "");
  to.documentElement.className = from.documentElement.className;
  to.body.className = from.body.className;
  to.body.style.margin = "0";
  to.body.style.height = "100vh";
  to.body.style.background = "var(--gryt-neutral-1)";
}

/**
 * The call in a window of its own. Document Picture-in-Picture where the browser has it (it stays on
 * top by itself); a plain window elsewhere, Electron included, whose pin is the main process's.
 */
export async function openCallWindow(title: string, onClosed: () => void): Promise<CallWindow | null> {
  const pip = (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;
  let win: Window | null = null;
  try {
    win = !isElectron() && pip
      ? await pip.requestWindow({ width: WIDTH, height: HEIGHT })
      : window.open("about:blank", "_blank", `width=${WIDTH},height=${HEIGHT},resizable=yes`);
  } catch (error) {
    console.warn("[popout] window refused", error);
  }
  if (!win) return null;

  win.document.title = title;
  copyLook(document, win.document);
  const container = win.document.createElement("div");
  container.style.height = "100%";
  win.document.body.appendChild(container);

  let open = true;
  const opened = win;
  const closed = () => {
    if (!open) return;
    open = false;
    onClosed();
  };
  opened.addEventListener("pagehide", closed);
  // A plain popup can be closed without a pagehide reaching us; Picture-in-Picture always sends one.
  const poll = setInterval(() => opened.closed && (clearInterval(poll), closed()), 500);

  return {
    title,
    container,
    close: () => {
      clearInterval(poll);
      open = false;
      opened.close();
    },
  };
}
