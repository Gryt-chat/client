/**
 * Choosing what your owl looks like, instead of only what your name hashes to.
 *
 * Everybody already has an owl — `@gryt/owl` draws one from the nickname, and
 * that is what a member list shows for anyone who has not uploaded a picture.
 * This lets somebody take that owl and choose its colours, its expression and
 * what it is wearing.
 *
 * Three columns: the slots on a rail, every option for the chosen slot as a
 * grid of owls, and the owl itself pinned on the right where it does not scroll
 * away. That last part is the whole reason for this shape — comparing two hats
 * should be looking rather than remembering.
 *
 * Options are drawn, never named. The expression slot holds fourteen things and
 * `eyes-eyelashes-surprised` in a dropdown tells nobody anything.
 */

import {
  ACCESSORIES,
  accessoriesIn,
  type AccessorySlot,
  avatarSeed,
  decodeWorn,
  EAR_STYLES,
  type EarStyle,
  encodeWorn,
  owlAvatarDataUri,
  PALETTE_NAMES,
  PALETTE_SCHEMES,
  type PaletteScheme,
  type WornLook,
  wornToOptions,
} from "@gryt/owl";
import { Button, Dialog, Menu, Tabs, Tooltip } from "@gryt/ui";
import { type ReactElement,useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  PiBaseballCapFill,
  PiCameraFill,
  PiDownloadSimpleBold,
  PiEyeglassesFill,
  PiEyesFill,
  PiHoodieFill,
  PiPaletteFill,
  PiShuffleBold,
  PiTrashFill,
} from "react-icons/pi";

import {
  EXPORT_FORMATS,
  exportFilename,
  type ExportFormat,
  renderOwl,
  saveBlob,
} from "./owlExport";
import { markCosmeticSeen, readNewCosmetics } from "./owlSeen";
import { forgetLook, readWardrobe, rememberLook, type WardrobeEntry } from "./owlWardrobe";

/**
 * Phosphor has a clothing set, so five of the six slots have a glyph. It has no
 * scarf, tie or necklace in 1,505 icons, so the neck one is drawn — filled, on
 * the same 256 grid, so it sits in the rail without announcing itself.
 */
function BowtieIcon({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden="true" height={size} viewBox="0 0 256 256" width={size} fill="currentColor">
      <path d="M104 96 44 66a14 14 0 0 0-20 12v100a14 14 0 0 0 20 12l60-30Z" />
      <path d="M152 96 212 66a14 14 0 0 1 20 12v100a14 14 0 0 1-20 12l-60-30Z" />
      <rect x="100" y="96" width="56" height="64" rx="16" />
    </svg>
  );
}

/** What each slot is called to somebody who has never read the code. */
const SLOTS: { slot: AccessorySlot; label: string; Icon: (p: { size?: number }) => ReactElement }[] = [
  { slot: "expression", label: "Expression", Icon: ({ size = 18 }) => <PiEyesFill size={size} /> },
  { slot: "eyewear", label: "Glasses", Icon: ({ size = 18 }) => <PiEyeglassesFill size={size} /> },
  { slot: "head", label: "Head", Icon: ({ size = 18 }) => <PiBaseballCapFill size={size} /> },
  { slot: "neck", label: "Neck", Icon: BowtieIcon },
  { slot: "body", label: "Clothes", Icon: ({ size = 18 }) => <PiHoodieFill size={size} /> },
];

/** Colour is not a slot, but it is a thing you pick, so it sits with them. */
const COLOUR = "colour" as const;
type Pane = AccessorySlot | typeof COLOUR;

/** A drawing's own name, without the type it already sits under. */
function optionLabel(name: string): string {
  return name.replace(/^[a-z]+-/, "").replace(/-/g, " ");
}

const BARE: WornLook["wearing"] = {
  expression: null,
  eyewear: null,
  head: null,
  neck: null,
  body: null,
};

function startingLook(): WornLook {
  const [first] = readWardrobe();
  return (
    (first && decodeWorn(first.worn)) ?? {
      palette: PALETTE_NAMES[0],
      scheme: "day",
      ears: "tufts",
      wearing: { ...BARE },
    }
  );
}

function randomLook(): WornLook {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
  const wearing: WornLook["wearing"] = { ...BARE };
  for (const { slot } of SLOTS) {
    const options = accessoriesIn(slot);
    // Roughly a third empty per slot, so a roll is a look rather than a pile.
    wearing[slot] = Math.random() < 0.34 || options.length === 0 ? null : pick(options).name;
  }
  return {
    palette: pick(PALETTE_NAMES),
    scheme: pick(PALETTE_SCHEMES),
    ears: pick(EAR_STYLES),
    wearing,
  };
}

/**
 * The chosen owl as a PNG, at the size an avatar is displayed.
 *
 * Rendered through an <img> and a canvas so the browser rasterises the same SVG
 * it would have drawn on screen.
 */
async function renderToPng(seed: string, look: WornLook, size = 512): Promise<Blob> {
  const svg = owlAvatarDataUri(seed, { ...wornToOptions(look), size });

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("could not draw the owl"));
    image.src = svg;
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context");
  context.drawImage(image, 0, 0, size, size);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not encode the owl"))),
      "image/png",
    );
  });
}

/**
 * The preview owl, cross-faded rather than swapped.
 *
 * Changing an `<img>`'s src tears the old picture down, decodes the new one and
 * puts it up, and the gap between those is a frame of nothing. Every equip
 * flashed.
 *
 * So each look is a layer of its own, stacked, and the new one fades in over
 * the old. Two rules make it never blank:
 *
 *   - a layer does not start fading until its own image has decoded, so there
 *     is always a finished picture underneath the one arriving;
 *   - the layers below are only dropped once the top one is fully opaque.
 *
 * Clicking quickly is fine. Several layers can be in flight, they fade on their
 * own timers, and whichever finishes last wins — there is no queue to get out of
 * order and nothing to cancel.
 */
function CrossfadeOwl({ src, className }: { src?: string; className?: string }) {
  // Newest last. Each entry is one rendered look.
  const [layers, setLayers] = useState<{ src: string; id: number }[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (!src) return;
    setLayers((prev) => {
      // Re-selecting what is already shown should do nothing at all, rather
      // than fade the same picture over itself.
      if (prev.length > 0 && prev[prev.length - 1].src === src) return prev;
      return [...prev, { src, id: nextId.current++ }];
    });
  }, [src]);

  const settle = useCallback((id: number) => {
    // Everything below the settled layer has been covered, so it can go. Keeping
    // them would stack a few hundred KB of data URIs over a long session.
    setLayers((prev) => {
      const i = prev.findIndex((l) => l.id === id);
      return i <= 0 ? prev : prev.slice(i);
    });
  }, []);

  return (
    <div className={`relative ${className ?? ""}`}>
      {layers.map((layer, i) => (
        <OwlLayer
          key={layer.id}
          // The first one has nothing to fade over, so it is simply there. A
          // fade on open would read as the dialog loading.
          immediate={i === 0}
          onSettled={() => settle(layer.id)}
          src={layer.src}
        />
      ))}
    </div>
  );
}

/**
 * Button's interaction, borrowed for the rail's tabs.
 *
 * @gryt/ui's Tab animates its colour and nothing else. Until it grows a press
 * of its own this keeps the rail feeling like the rest of the dialog — the same
 * numbers Button and the option tiles use, so the three do not disagree.
 */
const TAB_PRESS =
  "transition-[scale,color,background-color] duration-(--gryt-dur-spring) ease-spring "
  + "motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.96] motion-reduce:transition-none";

const FADE_MS = 250;

function OwlLayer({
  src,
  immediate,
  onSettled,
}: {
  src: string;
  immediate: boolean;
  onSettled: () => void;
}) {
  const [shown, setShown] = useState(immediate);

  const reveal = useCallback(() => {
    if (immediate) return;
    // Two frames, not one. A single rAF can land in the same style flush as the
    // mount, and the browser then has no starting value to animate from — the
    // layer snaps in and the flash is back.
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  }, [immediate]);

  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(onSettled, immediate ? 0 : FADE_MS);
    return () => clearTimeout(t);
  }, [shown, immediate, onSettled]);

  return (
    <img
      alt=""
      // decode="sync" so onLoad means it is ready to paint, not merely fetched.
      className="absolute inset-0 h-full w-full rounded-full object-contain motion-reduce:transition-none"
      onLoad={reveal}
      src={src}
      style={{
        opacity: shown ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    />
  );
}

/**
 * Writing the owl out as a file.
 *
 * A menu rather than four buttons, because three of the four are the same
 * picture flattened and only one of them is a decision most people need to
 * think about. SVG is first: it is what the generator produces, it is a few
 * kilobytes, and it has no resolution to be wrong about.
 */
function SaveAs({
  seed,
  look,
  nickname,
}: {
  seed: string;
  look: WornLook;
  nickname: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const save = useCallback(
    async (format: ExportFormat) => {
      if (!seed) return;
      setBusy(format.id);
      try {
        const blob = await renderOwl(seed, look, format);
        saveBlob(blob, exportFilename(nickname, format));
      } catch (err) {
        // A browser that cannot encode the format hands back null rather than
        // throwing, and renderOwl turns that into an error worth showing —
        // saving nothing silently is the outcome to avoid.
        toast.error(err instanceof Error ? err.message : "Could not save the owl");
      } finally {
        setBusy(null);
      }
    },
    [seed, look, nickname],
  );

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button disabled={busy !== null} size="small" tone="neutral" />
        }
      >
        <PiDownloadSimpleBold size={15} />
        {busy ? "Saving..." : "Save as"}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" side="top" sideOffset={6}>
          <Menu.Popup>
            {EXPORT_FORMATS.map((format) => (
              <Menu.Item key={format.id} onClick={() => void save(format)}>
                <span className="font-medium">{format.label}</span>
                <span className="ml-auto pl-4 text-xs text-gryt-muted">{format.hint}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/* --- the choice, when you click your avatar ------------------------------ */

export function AvatarChoiceDialog({
  open,
  nickname,
  onOpenChange,
  onUpload,
  onDesign,
}: {
  open: boolean;
  nickname: string;
  onOpenChange: (open: boolean) => void;
  onUpload: () => void;
  onDesign: () => void;
}) {
  const seed = avatarSeed(nickname) ?? "";
  const preview = useMemo(
    () => (seed ? owlAvatarDataUri(seed, { size: 96 }) : undefined),
    [seed],
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/*
          `forceRender`, and it is load-bearing rather than tidying.

          Base UI drops a dialog's backdrop when that dialog is nested inside
          another one — `enabled: forceRender || !nested` in DialogBackdrop. The
          whole settings panel is a Dialog (settings.tsx), and this renders
          inside it, so both of these count as nested and shipped with no
          backdrop at all.

          That cost two things, not one. Nothing dimmed behind the dialog, and
          it could not be dismissed by clicking away: Base UI only treats an
          outside press as a dismissal when the click landed on *that dialog's
          own* backdrop, so with no backdrop there was nothing to land on and
          the only way out was Save.
        */}
        <Dialog.Backdrop forceRender />
        <Dialog.Popup className="w-[30rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>Your avatar</Dialog.Title>
          <Dialog.Description className="mt-2 mb-4">
            Gryt draws you an owl from your name. Choose how it looks, or use a
            picture instead.
          </Dialog.Description>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onDesign}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface p-5 text-center transition-colors hover:bg-gryt-surface-hover"
            >
              <img alt="" className="size-16 rounded-full" src={preview} />
              <span className="text-sm font-semibold text-gryt-text">Design your owl</span>
              <span className="text-xs text-gryt-muted">
                Its colours, its expression, and what it is wearing.
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onUpload();
              }}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface p-5 text-center transition-colors hover:bg-gryt-surface-hover"
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-gryt-surface-raised">
                <PiCameraFill aria-hidden size={24} />
              </span>
              <span className="text-sm font-semibold text-gryt-text">Upload a picture</span>
              <span className="text-xs text-gryt-muted">PNG, JPG, WebP or GIF.</span>
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* --- the editor ---------------------------------------------------------- */

export function OwlDesignerDialog({
  open,
  nickname,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  nickname: string;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (png: Blob, worn: string) => void;
}) {
  const seed = avatarSeed(nickname) ?? "";
  const [look, setLook] = useState<WornLook>(startingLook);
  const [pane, setPane] = useState<Pane>("expression");
  const [wardrobe, setWardrobe] = useState<WardrobeEntry[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const gridRef = useRef<HTMLDivElement>(null);

  // Every cosmetic this build knows, which is what "new" is measured against.
  const allNames = useMemo(() => ACCESSORIES.map((a) => a.name), []);

  useEffect(() => {
    if (!open) return;
    setLook(startingLook());
    setPane("expression");
    setWardrobe(readWardrobe());
    // Read on open rather than on mount: the dialog outlives a session, and
    // cosmetics can arrive in an update between two openings of it.
    setFresh(readNewCosmetics(allNames));
  }, [open, allNames]);

  const worn = useMemo(() => encodeWorn(look), [look]);
  const preview = useMemo(
    () => (seed ? owlAvatarDataUri(seed, { ...wornToOptions(look), size: 320 }) : undefined),
    [seed, look],
  );

  /*
   * A thumbnail is your owl with the one thing swapped in, rather than a bare
   * bird wearing it alone. Seeing a hat on the face you already chose is the
   * thing being decided; seeing it on a stranger is a different question.
   *
   * The cost is that a hat sits in every expression thumbnail, which is fine
   * and is arguably the point — if it hides the eyes, that is worth knowing
   * before choosing rather than after.
   */
  const thumb = useCallback(
    (over: Partial<WornLook>) =>
      owlAvatarDataUri(seed, {
        ...wornToOptions({ ...look, ...over, wearing: { ...look.wearing, ...over.wearing } }),
        size: 128,
      }),
    [seed, look],
  );

  const wear = useCallback(
    (slot: AccessorySlot, name: string | null) => {
      setLook((now) => ({ ...now, wearing: { ...now.wearing, [slot]: name } }));
      // Putting a thing on is the moment you have actually looked at it, and
      // the moment the dot has done its job. Hovering or scrolling past is not.
      if (name) setFresh(markCosmeticSeen(name, allNames));
    },
    [allNames],
  );

  const handleSave = useCallback(async () => {
    setWardrobe(rememberLook(worn));
    onSave(await renderToPng(seed, look), worn);
  }, [look, worn, seed, onSave]);

  const activeSlot = pane === COLOUR ? null : pane;
  const options = activeSlot ? accessoriesIn(activeSlot) : [];
  const paneLabel = SLOTS.find((s) => s.slot === pane)?.label ?? "Colour";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* See the note on the chooser's backdrop above. */}
        <Dialog.Backdrop forceRender />
        {/*
          overflow-hidden, because p-0 lets the rail paint its own background
          right up to the edge. Dialog.Popup has the radius and the border, but
          nothing was clipping the children to it, so a square rail painted over
          two rounded corners and the dialog looked like it had none.
        */}
        <Dialog.Popup className="w-[54rem] max-w-[calc(100vw-2rem)] overflow-hidden p-0">
          <div className="flex flex-col md:flex-row">
            {/*
              Gryt UI's vertical Tabs, not a row of buttons.

              This was hand-rolled, and the two things that gave it away were
              the two things Tabs brings: nothing slid between panes because
              there was no Indicator, and nothing grew or shrank under the
              cursor because the buttons only animated their colour. The grid of
              owls immediately below does have the spring, which is what made
              the rail feel dead next to it.

              The scale classes are passed per tab rather than lived with,
              because @gryt/ui's Tab has no press feedback of its own yet.
              Matching Button exactly: 1.03 on hover, 0.96 on press, on the
              spring duration and curve.
            */}
            <Tabs
              className="shrink-0 border-b border-gryt-border bg-gryt-surface md:w-48 md:border-r md:border-b-0"
              onValueChange={(value) => setPane(String(value) as typeof pane)}
              orientation="vertical"
              value={pane}
            >
              <Tabs.List aria-label="What to change" className="gap-1 p-3">
                {SLOTS.map(({ slot, label, Icon }) => {
                  const chosen = Boolean(look.wearing[slot]);
                  const newHere = accessoriesIn(slot).filter((a) => fresh.has(a.name)).length;
                  return (
                    <Tabs.Tab
                      className={TAB_PRESS}
                      key={slot}
                      value={slot}
                    >
                      <Icon size={18} />
                      <span>{label}</span>
                      {chosen && pane !== slot && (
                        <span className="size-1.5 rounded-full bg-gryt-accent" aria-hidden />
                      )}
                      {/*
                        The count rather than a bare dot. "3 new hats" is worth
                        opening a pane for and "something changed in here" is
                        not, and the number costs the same space the total
                        already takes.
                      */}
                      {newHere > 0 ? (
                        <span
                          className="ml-auto rounded-full bg-gryt-accent px-1.5 font-mono text-[0.65rem] text-gryt-on-accent"
                          title={`${newHere} new`}
                        >
                          +{newHere}
                        </span>
                      ) : (
                        <span className="ml-auto pl-2 font-mono text-[0.65rem] opacity-70">
                          {accessoriesIn(slot).length}
                        </span>
                      )}
                    </Tabs.Tab>
                  );
                })}
                <Tabs.Tab className={TAB_PRESS} value={COLOUR}>
                  <PiPaletteFill size={18} />
                  <span>Colour</span>
                  <span className="ml-auto pl-2 font-mono text-[0.65rem] opacity-70">
                    {PALETTE_NAMES.length}
                  </span>
                </Tabs.Tab>
                <Tabs.Indicator />
              </Tabs.List>
            </Tabs>

            {/* grid */}
            <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
              <div className="flex items-baseline justify-between gap-4">
                <Dialog.Title className="text-base font-semibold">{paneLabel}</Dialog.Title>
                <span className="text-xs text-gryt-muted">
                  {pane === COLOUR ? `${PALETTE_NAMES.length} palettes` : `${options.length} drawn`}
                </span>
              </div>

              <div
                ref={gridRef}
                className="-mx-1.5 grid max-h-[22rem] grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-2 overflow-y-auto p-1.5"
              >
                {activeSlot && (
                  <button
                    type="button"
                    onClick={() => wear(activeSlot, null)}
                    className={
                      "flex aspect-square cursor-pointer flex-col items-center justify-center "
                      + "rounded-(--gryt-radius-md) text-[0.65rem] "
                      + "transition-[scale,outline-color,background-color] "
                      + "duration-(--gryt-dur-spring) ease-spring "
                      + "motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.96] "
                      + "focus-visible:outline-2 focus-visible:outline-offset-2 "
                      + "focus-visible:outline-gryt-accent-light "
                      + (look.wearing[activeSlot]
                        ? "outline outline-1 outline-dashed outline-gryt-border text-gryt-muted "
                          + "hover:bg-gryt-surface-hover"
                        : "outline outline-[3px] outline-offset-[-1.5px] outline-gryt-accent "
                          + "bg-gryt-surface-raised text-gryt-text motion-safe:scale-[1.04] "
                          + "motion-safe:hover:scale-[1.06]")
                    }
                  >
                    Nothing
                  </button>
                )}

                {activeSlot &&
                  options.map((a) => {
                    const on = look.wearing[activeSlot] === a.name;
                    const isNew = fresh.has(a.name);
                    return (
                      <Tooltip key={a.name} title={isNew ? `${optionLabel(a.name)} — new` : optionLabel(a.name)}>
                        {/*
                          The dot hangs off the tile rather than sitting inside
                          it. The tiles scale on hover and press, and anything
                          inside scales with them — a badge that grows when you
                          reach for it reads as a second thing moving.
                        */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => wear(activeSlot, a.name)}
                            aria-label={optionLabel(a.name)}
                            className={
                              "block w-full cursor-pointer overflow-hidden rounded-(--gryt-radius-md) "
                              + "transition-[scale,outline-color,background-color] "
                              + "duration-(--gryt-dur-spring) ease-spring "
                              + "motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.96] "
                              + "focus-visible:outline-2 focus-visible:outline-offset-2 "
                              + "focus-visible:outline-gryt-accent-light "
                              + (on
                                ? "outline outline-[3px] outline-offset-[-1.5px] outline-gryt-accent "
                                  + "bg-gryt-surface-raised motion-safe:scale-[1.04] "
                                  + "motion-safe:hover:scale-[1.06]"
                                : "outline outline-0 outline-transparent hover:bg-gryt-surface-hover")
                            }
                          >
                            <img
                              alt=""
                              className="block aspect-square w-full"
                              src={thumb({ wearing: { [activeSlot]: a.name } })}
                            />
                          </button>
                          {isNew && (
                            <span
                              aria-hidden
                              className="pointer-events-none absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-gryt-accent ring-2 ring-gryt-surface"
                            />
                          )}
                        </div>
                      </Tooltip>
                    );
                  })}

                {pane === COLOUR &&
                  PALETTE_NAMES.map((name) => {
                    const on = look.palette === name;
                    return (
                      <Tooltip key={name} title={name}>
                        <button
                          type="button"
                          onClick={() => setLook((now) => ({ ...now, palette: name }))}
                          aria-label={name}
                          className={
                            "cursor-pointer overflow-hidden rounded-(--gryt-radius-md) "
                            + "transition-[scale,outline-color,background-color] "
                            + "duration-(--gryt-dur-spring) ease-spring "
                            + "motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.96] "
                            + "focus-visible:outline-2 focus-visible:outline-offset-2 "
                            + "focus-visible:outline-gryt-accent-light "
                            + (on
                              ? "outline outline-[3px] outline-offset-[-1.5px] outline-gryt-accent "
                                + "bg-gryt-surface-raised motion-safe:scale-[1.04] "
                                + "motion-safe:hover:scale-[1.06]"
                              : "outline outline-0 outline-transparent hover:bg-gryt-surface-hover")
                          }
                        >
                          <img
                            alt=""
                            className="block aspect-square w-full"
                            src={owlAvatarDataUri(seed, {
                              ...wornToOptions(look),
                              palette: name,
                              size: 128,
                            })}
                          />
                        </button>
                      </Tooltip>
                    );
                  })}
              </div>

              {pane === COLOUR && (
                <div className="flex flex-wrap gap-4">
                  <Field label="Time of day">
                    {PALETTE_SCHEMES.map((s) => (
                      <Pill
                        key={s}
                        on={look.scheme === s}
                        onClick={() => setLook((now) => ({ ...now, scheme: s as PaletteScheme }))}
                      >
                        {s}
                      </Pill>
                    ))}
                  </Field>
                  <Field label="Ears">
                    {EAR_STYLES.map((e) => (
                      <Pill
                        key={e}
                        on={look.ears === e}
                        onClick={() => setLook((now) => ({ ...now, ears: e as EarStyle }))}
                      >
                        {e}
                      </Pill>
                    ))}
                  </Field>
                </div>
              )}

              {wardrobe.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-gryt-border pt-3">
                  <span className="text-[0.65rem] font-semibold tracking-wider text-gryt-muted uppercase">
                    Worn before
                  </span>
                  <div className="-mx-1.5 flex gap-2 overflow-x-auto p-1.5">
                    {wardrobe.map((entry) => {
                      const past = decodeWorn(entry.worn);
                      if (!past) return null;
                      return (
                        <div key={entry.worn} className="group relative shrink-0">
                          <button
                            type="button"
                            onClick={() => setLook(past)}
                            aria-label="Wear this again"
                            className={
                              "block cursor-pointer overflow-hidden rounded-(--gryt-radius-md) "
                              + "transition-[scale,outline-color] duration-(--gryt-dur-spring) ease-spring "
                              + "motion-safe:hover:scale-[1.03] motion-safe:active:scale-[0.96] "
                              + "focus-visible:outline-2 focus-visible:outline-offset-2 "
                              + "focus-visible:outline-gryt-accent-light "
                              + (entry.worn === worn
                                ? "outline outline-[3px] outline-offset-[-1.5px] outline-gryt-accent"
                                : "outline outline-1 outline-gryt-border hover:outline-gryt-accent")
                            }
                          >
                            <img
                              alt=""
                              className="block size-14"
                              src={owlAvatarDataUri(seed, { ...wornToOptions(past), size: 128 })}
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => setWardrobe(forgetLook(entry.worn))}
                            aria-label="Forget this look"
                            className="absolute -top-1.5 -right-1.5 hidden size-5 cursor-pointer items-center justify-center rounded-full border border-gryt-border bg-gryt-surface-raised text-gryt-muted hover:text-gryt-text group-hover:flex"
                          >
                            <PiTrashFill size={10} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* the owl */}
            <div className="flex shrink-0 flex-col items-center gap-3 border-t border-gryt-border bg-gryt-surface p-4 md:w-56 md:border-t-0 md:border-l">
              <CrossfadeOwl className="h-40 w-40" src={preview} />
              <span className="text-xs text-gryt-muted">{nickname}</span>
              <div className="mt-auto flex w-full flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setLook(randomLook())}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-full border border-gryt-border px-4 py-2 text-sm text-gryt-text transition-colors hover:bg-gryt-surface-hover"
                >
                  <PiShuffleBold size={15} />
                  Surprise me
                </button>
                <Button disabled={saving} onClick={() => void handleSave()} size="small">
                  {saving ? "Saving..." : "Use this owl"}
                </Button>
                <SaveAs look={look} nickname={nickname} seed={seed} />
                <Button
                  disabled={saving}
                  onClick={() => onOpenChange(false)}
                  size="small"
                  tone="neutral"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[0.65rem] font-semibold tracking-wider text-gryt-muted uppercase">
        {label}
      </span>
      <div className="flex gap-1.5">{children}</div>
    </div>
  );
}

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-full px-3 py-1 text-xs capitalize transition-colors ${
        on
          ? "bg-gryt-accent text-gryt-on-accent font-semibold"
          : "border border-gryt-border text-gryt-muted hover:bg-gryt-surface-hover"
      }`}
    >
      {children}
    </button>
  );
}
