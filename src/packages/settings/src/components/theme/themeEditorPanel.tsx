import type { GrytAppearance } from "@gryt/ui";
import { Button, encodeDraft,ThemeEditor } from "@gryt/ui";
import { ArrowCounterClockwise, Link as LinkIcon, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCustomThemes, useTheme, useThemeEditor } from "@/common";
import { useSettings } from "@/settings";

/**
 * The theme editor, floating over the running app.
 *
 * Not a Dialog, and that is the whole point rather than an implementation
 * detail. A Dialog traps focus and dims what is behind it, and what is behind
 * it is the thing being edited — the member list, a voice tile, a mention.
 * Somebody should be able to drag a slider, click into a channel, hover a
 * card, and drag the slider again without the panel getting in the way. So it
 * is a plain fixed element with no backdrop and nothing captured.
 *
 * It is dragged by its header and remembers where it was left, because the
 * only reliable way to see what a colour does to one corner of the app is to
 * move the panel off that corner.
 */

const POSITION_KEY = "theme.editor.position";
const WIDTH = 380;
/** Enough of the header to grab after a window resize leaves it half off. */
const KEEP_VISIBLE = 96;

interface Position {
  x: number;
  y: number;
}

function readPosition(): Position {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as Position).x === "number" &&
        typeof (parsed as Position).y === "number"
      ) {
        return parsed as Position;
      }
    }
  } catch {
    /* A position is not worth failing over. */
  }
  return { x: 24, y: 72 };
}

/** Never off-screen, however the window changed since this was written down. */
function clamp(position: Position): Position {
  const maxX = Math.max(0, window.innerWidth - KEEP_VISIBLE);
  const maxY = Math.max(0, window.innerHeight - KEEP_VISIBLE);
  return {
    x: Math.min(Math.max(0, position.x), maxX),
    y: Math.min(Math.max(0, position.y), maxY)
  };
}

export function ThemeEditorPanel() {
  const { open, draft, closeEditor, setDraft, revert, openedWith } =
    useThemeEditor();
  const { saveTheme } = useCustomThemes();
  const { resolvedAppearance, setAppearancePreference } = useTheme();
  const { googleFontsEnabled } = useSettings();

  const [position, setPosition] = useState<Position>(readPosition);
  const [copied, setCopied] = useState(false);
  const dragging = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    setPosition((current) => clamp(current));
    const onResize = () => setPosition((current) => clamp(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  /* Listeners on the window rather than the header, so a fast drag that leaves
     the grab area behind keeps moving the panel instead of dropping it. */
  useEffect(() => {
    if (!open) return;

    function onMove(event: PointerEvent) {
      const grab = dragging.current;
      if (grab === null) return;
      setPosition(clamp({ x: event.clientX - grab.dx, y: event.clientY - grab.dy }));
    }
    function onUp() {
      if (dragging.current === null) return;
      dragging.current = null;
      setPosition((current) => {
        localStorage.setItem(POSITION_KEY, JSON.stringify(current));
        return current;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [open]);

  const startDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Only the header itself, so the buttons in it still work.
      if (event.target !== event.currentTarget) return;
      // Belt and braces with select-none above: this also stops the browser
      // starting its own drag of whatever is under the cursor.
      event.preventDefault();
      dragging.current = {
        dx: event.clientX - position.x,
        dy: event.clientY - position.y
      };
    },
    [position]
  );

  const copyLink = useCallback(() => {
    if (draft === null) return;
    const query = encodeDraft(draft, resolvedAppearance).toString();
    void navigator.clipboard?.writeText(
      `https://ui.gryt.chat/theme/generator${query === "" ? "" : `?${query}`}`
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [draft, resolvedAppearance]);

  if (!open || draft === null) return null;

  const dirty = draft !== openedWith;

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface shadow-2xl"
      style={{
        left: position.x,
        top: position.y,
        width: WIDTH,
        maxHeight: "min(80vh, 46rem)"
      }}
    >
      {/* select-none because a drag is a drag. Without it the pointer sweeping
          across the panel selects every label it passes, so letting go leaves
          the editor striped blue and the next keystroke would replace a
          heading. */}
      <div
        className="flex cursor-grab touch-none select-none items-center gap-2 border-b border-gryt-border bg-gryt-surface-raised px-3 py-2 active:cursor-grabbing"
        onPointerDown={startDrag}
      >
        <span className="pointer-events-none text-xs font-semibold uppercase tracking-wider text-gryt-muted">
          Theme editor
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            disabled={!dirty}
            onClick={revert}
            size="small"
            title="Back to the theme this opened on"
            tone="ghost"
          >
            <ArrowCounterClockwise aria-hidden="true" size={14} />
            Revert
          </Button>
          <Button onClick={copyLink} size="small" tone="ghost">
            <LinkIcon aria-hidden="true" size={14} />
            {copied ? "Copied" : "Link"}
          </Button>
          <Button aria-label="Close editor" onClick={closeEditor} size="small" tone="ghost">
            <X aria-hidden="true" size={14} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ThemeEditor
          appearance={resolvedAppearance}
          onAppearanceChange={(next: GrytAppearance) =>
            setAppearancePreference(next)
          }
          onChange={setDraft}
          remoteFontsAllowed={googleFontsEnabled}
          value={draft}
        />
      </div>

      <div className="flex items-center gap-2 border-t border-gryt-border bg-gryt-surface-raised px-3 py-2">
        <span className="text-xs text-gryt-muted">
          {dirty ? "Not saved" : "Saved"}
        </span>
        <div className="ml-auto flex gap-2">
          <Button onClick={closeEditor} size="small" tone="neutral">
            Close
          </Button>
          <Button
            disabled={!dirty}
            onClick={() => {
              saveTheme(draft.name ?? "Custom theme", draft);
              closeEditor();
            }}
            size="small"
          >
            Save as new theme
          </Button>
        </div>
      </div>
    </div>
  );
}
