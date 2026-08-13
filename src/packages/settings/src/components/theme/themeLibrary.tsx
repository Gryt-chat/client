import type { GrytTheme } from "@gryt/ui";
import {
  AlertDialog,
  Button,
  encodeGrytTheme,
  grytPresets,
  grytThemeHues,
} from "@gryt/ui";
import { useState } from "react";
import toast from "react-hot-toast";
import {
  PiCheckBold,
  PiLinkSimpleBold,
  PiPencilSimpleBold,
  PiTrashBold,
} from "react-icons/pi";

import type { SavedTheme } from "@/common";
import { presetThemeId, useCustomThemes, useTheme } from "@/common";

import { ImportThemeDialog } from "./importThemeDialog";

const GENERATOR = "https://ui.gryt.chat/theme/generator";

/**
 * The themes on this machine, and the one in use.
 *
 * The built-in half comes from @gryt/ui rather than from a list here, so a
 * newer library brings new ones with it and nobody has to copy a palette
 * across. They cannot be deleted — there has to be something to go back to —
 * but any of them opens in the generator, for somebody who wants Dracula with
 * a different accent.
 */
export function ThemeLibrary() {
  const { themes, activeId, setActiveTheme, deleteTheme } = useCustomThemes();
  const { resolvedAppearance } = useTheme();
  const [importing, setImporting] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {grytPresets.map((preset) => (
          <li key={preset.id}>
            <ThemeRow
              active={
                preset.id === "gryt"
                  ? activeId === null
                  : activeId === presetThemeId(preset.id)
              }
              appearance={resolvedAppearance}
              name={preset.name}
              note={preset.note}
              theme={preset.theme}
              onSelect={() =>
                setActiveTheme(
                  // Gryt's own is the absence of a theme rather than a theme:
                  // nothing on the root, the stylesheet as shipped.
                  preset.id === "gryt" ? null : presetThemeId(preset.id),
                )
              }
              onOpenInGenerator={() => openInGenerator(preset.theme)}
            />
          </li>
        ))}
        {themes.map((entry) => (
          <li key={entry.id}>
            <ThemeRow
              active={activeId === entry.id}
              appearance={resolvedAppearance}
              name={entry.name}
              note="Imported"
              theme={entry.theme}
              onSelect={() => setActiveTheme(entry.id)}
              onCopyLink={() => copyLink(entry)}
              onOpenInGenerator={() => openInGenerator(entry.theme)}
              onDelete={() => deleteTheme(entry.id)}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button size="small" onClick={() => setImporting(true)}>
          Import a theme
        </Button>
        <a
          className="text-xs text-gryt-accent-11 hover:underline"
          href={GENERATOR}
          rel="noreferrer"
          target="_blank"
        >
          Make one
        </a>
      </div>

      <ImportThemeDialog open={importing} onOpenChange={setImporting} />
    </div>
  );
}

/** The theme, loaded into the generator, ready to be argued with. */
function openInGenerator(theme: GrytTheme) {
  window.open(
    `${GENERATOR}?${encodeGrytTheme(theme).toString()}`,
    "_blank",
    "noreferrer",
  );
}

function copyLink(entry: SavedTheme) {
  const url = `${GENERATOR}?${encodeGrytTheme(entry.theme).toString()}`;
  void navigator.clipboard
    ?.writeText(url)
    // The link opens the generator with the theme loaded, so "copied" is only
    // half of what happened and the other half is the useful half.
    .then(() => toast.success("Link copied — it opens in the generator"))
    .catch(() => toast.error("Could not copy the link"));
}

function ThemeRow({
  active,
  appearance,
  name,
  note,
  theme,
  onSelect,
  onCopyLink,
  onOpenInGenerator,
  onDelete,
}: {
  active: boolean;
  appearance: "dark" | "light";
  name: string;
  note: string;
  theme: GrytTheme;
  onSelect: () => void;
  onCopyLink?: () => void;
  onOpenInGenerator?: () => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const neutrals = theme[appearance];
  const hues = grytThemeHues(theme, appearance);

  return (
    <div
      className={[
        "flex items-center gap-3 rounded-(--gryt-radius-lg) border p-3 transition-colors",
        active
          ? "border-gryt-accent bg-gryt-neutral-3"
          : "border-gryt-border hover:bg-gryt-neutral-3",
      ].join(" ")}
    >
      {/* The whole row selects, so the target is the row rather than a 16px
          radio. It is a button for the same reason: this is one control. */}
      <button
        aria-pressed={active}
        className="flex min-w-0 flex-1 items-center gap-3 bg-transparent text-left"
        type="button"
        onClick={onSelect}
      >
        <span
          aria-hidden="true"
          className="flex shrink-0 overflow-hidden rounded-(--gryt-radius-md) border border-gryt-border"
        >
          {[neutrals.bg, neutrals.surface, hues.accent, hues.secondary].map(
            (colour, index) => (
              <span
                key={index}
                className="block h-8 w-4"
                style={{ backgroundColor: colour }}
              />
            ),
          )}
        </span>

        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="truncate text-xs text-gryt-muted">{note}</span>
        </span>

        {active ? (
          <PiCheckBold aria-label="In use" className="shrink-0 text-gryt-accent-11" />
        ) : null}
      </button>

      {onOpenInGenerator ? (
        <Button
          aria-label={`Open ${name} in the theme generator`}
          size="xsmall"
          tone="ghost"
          onClick={onOpenInGenerator}
        >
          <PiPencilSimpleBold />
        </Button>
      ) : null}

      {onCopyLink ? (
        <Button
          aria-label={`Copy a link to ${name}`}
          size="xsmall"
          tone="ghost"
          onClick={onCopyLink}
        >
          <PiLinkSimpleBold />
        </Button>
      ) : null}

      {onDelete ? (
        <AlertDialog.Root open={confirming} onOpenChange={setConfirming}>
          <Button
            aria-label={`Delete ${name}`}
            size="xsmall"
            tone="ghost"
            onClick={() => setConfirming(true)}
          >
            <PiTrashBold />
          </Button>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop />
            <AlertDialog.Popup className="max-w-[420px]">
              <AlertDialog.Title>Delete {name}?</AlertDialog.Title>
              <AlertDialog.Description>
                The theme is only on this machine. If you have the link it came
                from you can import it again; if you do not, this is the only
                copy.
              </AlertDialog.Description>
              <div className="mt-4 flex justify-end gap-3">
                <AlertDialog.Close render={<span />}>
                  <Button size="small" tone="neutral">
                    Keep it
                  </Button>
                </AlertDialog.Close>
                <Button
                  size="small"
                  tone="danger"
                  onClick={() => {
                    setConfirming(false);
                    onDelete();
                  }}
                >
                  Delete
                </Button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      ) : null}
    </div>
  );
}
