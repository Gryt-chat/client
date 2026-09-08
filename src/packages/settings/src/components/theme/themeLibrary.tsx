import type { GrytTheme } from "@gryt/ui";
import { Accordion, Button, encodeGrytTheme, grytPresetsByCollection } from "@gryt/ui";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import type { SavedTheme } from "@/common";
import { presetThemeId, useCustomThemes, useTheme } from "@/common";

import {
  PiCheckBold,
  PiLinkSimpleBold,
  PiPencilSimpleBold,
  PiTrashBold,
} from "../../../../../lib/icons";
import { ConfirmDialog } from "../../../../socket/src/components/ConfirmDialog";
import { ImportThemeDialog } from "./importThemeDialog";
import { ThemePreview } from "./themePreview";

const GENERATOR = "https://ui.gryt.chat/theme/generator";

/** Wide enough that the four panels still read as four panels. */
const PREVIEW_WIDTH = 208;

/** Imported themes are not a collection in the library, so they get a name here. */
const YOURS = "Yours";

const PRESET_PREFIX = "preset:";

/**
 * The themes on this machine, and the one in use.
 *
 * The built-in half comes from @gryt/ui rather than from a list here, so a
 * newer library brings new ones with it. They cannot be deleted — there has to
 * be something to go back to — but any of them opens in the generator.
 *
 * Collections are accordions because there are forty-seven presets now. Only
 * the collection holding the theme in use starts open: a list that long with
 * everything expanded is the same scroll it was before, and the row you want to
 * see is the one you are already wearing.
 */
export function ThemeLibrary() {
  const { themes, activeId, setActiveTheme, deleteTheme } = useCustomThemes();
  const { resolvedAppearance } = useTheme();
  const [importing, setImporting] = useState(false);

  // Whichever collection holds the theme in use, so opening Appearance shows
  // where you are rather than the top of the list.
  const openCollection = useMemo(() => {
    if (activeId === null) return "Gryt";
    if (!activeId.startsWith(PRESET_PREFIX)) return YOURS;
    const id = activeId.slice(PRESET_PREFIX.length);
    return (
      grytPresetsByCollection.find((group) =>
        group.presets.some((preset) => preset.id === id),
      )?.collection ?? "Gryt"
    );
  }, [activeId]);

  const [open, setOpen] = useState<string[]>([openCollection]);

  return (
    <div className="flex flex-col gap-2">
      <Accordion
        className="gap-1 p-1"
        multiple
        value={open}
        onValueChange={(value) => setOpen(value as string[])}
      >
        {grytPresetsByCollection.map((group) => (
          <Accordion.Item key={group.collection} value={group.collection}>
            <CollectionTrigger
              accents={group.presets.map((preset) => preset.theme.hue.accent)}
              count={group.presets.length}
              name={group.collection}
              note={group.note}
            />
            <Accordion.Panel>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {group.presets.map((preset) => (
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
                      source={preset.source}
                      theme={preset.theme}
                      onOpenInGenerator={() => openInGenerator(preset.theme)}
                      onSelect={() =>
                        setActiveTheme(
                          // Gryt's own is the absence of a theme rather than a
                          // theme: nothing on the root, the stylesheet as shipped.
                          preset.id === "gryt" ? null : presetThemeId(preset.id),
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            </Accordion.Panel>
          </Accordion.Item>
        ))}

        {themes.length > 0 && (
          <Accordion.Item value={YOURS}>
            <CollectionTrigger
              accents={themes.map((entry) => entry.theme.hue.accent)}
              count={themes.length}
              name={YOURS}
              note="Imported from a link."
            />
            <Accordion.Panel>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {themes.map((entry) => (
                  <li key={entry.id}>
                    <ThemeRow
                      active={activeId === entry.id}
                      appearance={resolvedAppearance}
                      name={entry.name}
                      note="Imported"
                      theme={entry.theme}
                      onCopyLink={() => copyLink(entry)}
                      onDelete={() => deleteTheme(entry.id)}
                      onOpenInGenerator={() => openInGenerator(entry.theme)}
                      onSelect={() => setActiveTheme(entry.id)}
                    />
                  </li>
                ))}
              </ul>
            </Accordion.Panel>
          </Accordion.Item>
        )}
      </Accordion>

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

function CollectionTrigger({
  accents,
  count,
  name,
  note,
}: {
  accents: string[];
  count: number;
  name: string;
  note: string;
}) {
  return (
    <Accordion.Trigger>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className="shrink-0">{name}</span>
        <span className="truncate text-xs font-normal text-gryt-muted">{note}</span>
      </span>
      {/* Four accents is enough to tell Winter from Autumn with the panel shut. */}
      <span aria-hidden="true" className="flex shrink-0 gap-1">
        {accents.slice(0, 4).map((accent, index) => (
          <span
            key={index}
            className="block h-2.5 w-2.5 rounded-full border border-gryt-border"
            style={{ backgroundColor: accent }}
          />
        ))}
      </span>
      <span className="shrink-0 text-xs font-normal tabular-nums text-gryt-muted">
        {count}
      </span>
    </Accordion.Trigger>
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

/**
 * The corner radius, drawn as a corner.
 *
 * The preview shows it truthfully and therefore almost invisibly: at a fifth of
 * size a 20px corner is four pixels, and Gryt and Solarized look equally square
 * there. This is the same value on a box standing in for a 44px panel, so the
 * shape is the theme's own ratio at a size you can see.
 */
function RadiusGlyph({ radius }: { radius: GrytTheme["radius"] }) {
  return (
    <span
      className="flex shrink-0 items-center gap-1.5 text-gryt-muted"
      title={`radius.lg ${radius.lg}px`}
    >
      <span
        aria-hidden="true"
        className="block h-5 w-5 border-t-2 border-l-2 border-current opacity-80"
        style={{ borderTopLeftRadius: Math.min(11, radius.lg * 0.5) }}
      />
      <span className="text-xs tabular-nums">{radius.lg}</span>
    </span>
  );
}

function ThemeRow({
  active,
  appearance,
  name,
  note,
  source,
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
  source?: string;
  theme: GrytTheme;
  onSelect: () => void;
  onCopyLink?: () => void;
  onOpenInGenerator?: () => void;
  onDelete?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      className={[
        "flex items-center gap-3 rounded-(--gryt-radius-lg) border p-2 transition-colors",
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
        <span className="block shrink-0 overflow-hidden rounded-(--gryt-radius-md) border border-gryt-border leading-none">
          <ThemePreview appearance={appearance} theme={theme} width={PREVIEW_WIDTH} />
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="text-xs text-gryt-muted">{note}</span>
          {source ? (
            <span className="truncate pt-0.5 text-[10px] text-gryt-muted opacity-75">
              {source}
            </span>
          ) : null}
        </span>

        <RadiusGlyph radius={theme.radius} />

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
        <>
          <Button
            aria-label={`Delete ${name}`}
            size="xsmall"
            tone="ghost"
            onClick={() => setConfirming(true)}
          >
            <PiTrashBold />
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Delete ${name}?`}
            description="The theme is only on this machine. If you have the link it came from you can import it again; if you do not, this is the only copy."
            confirmLabel="Delete"
            cancelLabel="Keep it"
            width="420px"
            onConfirm={onDelete}
          />
        </>
      ) : null}
    </div>
  );
}
