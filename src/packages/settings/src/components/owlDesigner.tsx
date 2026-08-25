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
import { Avatar, Button, Dialog, Tooltip } from "@gryt/ui";
import { type ReactElement,useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PiBaseballCapFill,
  PiCameraFill,
  PiEyeglassesFill,
  PiEyesFill,
  PiHoodieFill,
  PiPaletteFill,
  PiPencilSimpleFill,
  PiShuffleBold,
  PiTrashFill,
} from "react-icons/pi";

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
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[30rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>Your avatar</Dialog.Title>
          <Dialog.Description className="mt-2 mb-4">
            Gryt draws you an owl from your name. Choose how it looks, or use a
            picture instead.
          </Dialog.Description>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onDesign();
              }}
              className="flex cursor-pointer flex-col items-center gap-3 rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface p-4 text-center transition-colors hover:bg-gryt-surface-hover"
            >
              <img alt="" className="size-16 rounded-full" src={preview} />
              <span className="text-sm font-semibold text-gryt-text">Design your owl</span>
              <span className="text-xs text-gryt-muted">
                Its colours, its expression, and what it is wearing.
              </span>
              <PiPencilSimpleFill aria-hidden size={16} />
            </button>

            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onUpload();
              }}
              className="flex cursor-pointer flex-col items-center gap-3 rounded-(--gryt-radius-lg) border border-gryt-border bg-gryt-surface p-4 text-center transition-colors hover:bg-gryt-surface-hover"
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-gryt-surface-raised">
                <PiCameraFill aria-hidden size={24} />
              </span>
              <span className="text-sm font-semibold text-gryt-text">Upload a picture</span>
              <span className="text-xs text-gryt-muted">PNG, JPG, WebP or GIF.</span>
              <PiCameraFill aria-hidden className="opacity-0" size={16} />
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
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLook(startingLook());
    setPane("expression");
    setWardrobe(readWardrobe());
  }, [open]);

  const worn = useMemo(() => encodeWorn(look), [look]);
  const preview = useMemo(
    () => (seed ? owlAvatarDataUri(seed, { ...wornToOptions(look), size: 320 }) : undefined),
    [seed, look],
  );

  /* A thumbnail is the whole owl wearing the one thing, so what you see in the
     grid is what you get rather than a cropped hat floating on its own. */
  const thumb = useCallback(
    (over: Partial<WornLook>) =>
      owlAvatarDataUri(seed, {
        ...wornToOptions({ ...look, ...over, wearing: { ...BARE, ...over.wearing } }),
        size: 128,
      }),
    [seed, look],
  );

  const wear = useCallback((slot: AccessorySlot, name: string | null) => {
    setLook((now) => ({ ...now, wearing: { ...now.wearing, [slot]: name } }));
  }, []);

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
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[54rem] max-w-[calc(100vw-2rem)] p-0">
          <div className="flex flex-col md:flex-row">
            {/* rail */}
            <div className="flex shrink-0 flex-row gap-1 overflow-x-auto border-b border-gryt-border bg-gryt-surface p-3 md:w-48 md:flex-col md:border-r md:border-b-0">
              {SLOTS.map(({ slot, label, Icon }) => {
                const on = pane === slot;
                const chosen = Boolean(look.wearing[slot]);
                return (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setPane(slot)}
                    className={`flex shrink-0 cursor-pointer items-center gap-2.5 rounded-(--gryt-radius-md) px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                      on
                        ? "bg-gryt-accent text-gryt-on-accent"
                        : chosen
                          ? "text-gryt-text hover:bg-gryt-surface-hover"
                          : "text-gryt-muted hover:bg-gryt-surface-hover"
                    }`}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                    {chosen && !on && (
                      <span className="size-1.5 rounded-full bg-gryt-accent" aria-hidden />
                    )}
                    <span className="ml-auto pl-2 font-mono text-[0.65rem] opacity-70">
                      {accessoriesIn(slot).length}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setPane(COLOUR)}
                className={`flex shrink-0 cursor-pointer items-center gap-2.5 rounded-(--gryt-radius-md) px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors ${
                  pane === COLOUR
                    ? "bg-gryt-accent text-gryt-on-accent"
                    : "text-gryt-text hover:bg-gryt-surface-hover"
                }`}
              >
                <PiPaletteFill size={18} />
                <span>Colour</span>
                <span className="ml-auto pl-2 font-mono text-[0.65rem] opacity-70">
                  {PALETTE_NAMES.length}
                </span>
              </button>
            </div>

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
                className="grid max-h-[22rem] grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-2 overflow-y-auto"
              >
                {activeSlot && (
                  <button
                    type="button"
                    onClick={() => wear(activeSlot, null)}
                    className={`flex aspect-square cursor-pointer flex-col items-center justify-center rounded-(--gryt-radius-md) border text-[0.65rem] transition-colors ${
                      look.wearing[activeSlot]
                        ? "border-dashed border-gryt-border text-gryt-muted hover:bg-gryt-surface-hover"
                        : "border-gryt-accent bg-gryt-surface-raised text-gryt-text"
                    }`}
                  >
                    Nothing
                  </button>
                )}

                {activeSlot &&
                  options.map((a) => {
                    const on = look.wearing[activeSlot] === a.name;
                    return (
                      <Tooltip key={a.name} title={optionLabel(a.name)}>
                        <button
                          type="button"
                          onClick={() => wear(activeSlot, a.name)}
                          aria-label={optionLabel(a.name)}
                          className={`cursor-pointer overflow-hidden rounded-(--gryt-radius-md) border transition-colors ${
                            on ? "border-gryt-accent bg-gryt-surface-raised" : "border-transparent hover:bg-gryt-surface-hover"
                          }`}
                        >
                          <img
                            alt=""
                            className="block aspect-square w-full"
                            src={thumb({ wearing: { [activeSlot]: a.name } })}
                          />
                        </button>
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
                          className={`cursor-pointer overflow-hidden rounded-(--gryt-radius-md) border transition-colors ${
                            on ? "border-gryt-accent bg-gryt-surface-raised" : "border-transparent hover:bg-gryt-surface-hover"
                          }`}
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
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {wardrobe.map((entry) => {
                      const past = decodeWorn(entry.worn);
                      if (!past) return null;
                      return (
                        <div key={entry.worn} className="group relative shrink-0">
                          <button
                            type="button"
                            onClick={() => setLook(past)}
                            aria-label="Wear this again"
                            className={`block cursor-pointer overflow-hidden rounded-(--gryt-radius-md) border transition-colors ${
                              entry.worn === worn ? "border-gryt-accent" : "border-gryt-border hover:border-gryt-accent"
                            }`}
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
              <Avatar className="h-40 w-40" size="large" src={preview} />
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
