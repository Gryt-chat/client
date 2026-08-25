/**
 * Choosing what your owl looks like, instead of only what your name hashes to.
 *
 * Everybody already has an owl — `@gryt/owl` draws one from the nickname, and
 * that is what a member list shows for anyone who has not uploaded a picture.
 * This lets somebody take that owl and choose its colours, its expression and
 * what it is wearing.
 *
 * The result is saved through the ordinary avatar upload: the chosen owl is
 * rendered to a PNG and uploaded like any other picture. That is deliberate for
 * now — it needs nothing from the server, and every place an avatar already
 * appears shows it without knowing anything about owls. What it costs is that
 * the choices are not stored anywhere the server can see, so they are kept
 * locally and only so the editor reopens where it was left. See GRYT-592 for
 * what storing them properly would take.
 */

import {
  accessoriesIn,
  ACCESSORY_SLOTS,
  type AccessorySlot,
  avatarSeed,
  EAR_STYLES,
  type EarStyle,
  owlAvatarDataUri,
  PALETTE_NAMES,
  PALETTE_SCHEMES,
  type PaletteName,
  type PaletteScheme,
} from "@gryt/owl";
import { Avatar, Button, Dialog, Select } from "@gryt/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PiCameraFill, PiPencilSimpleFill } from "react-icons/pi";

/** What a person has chosen. Everything here is a choice, never a hash. */
export interface OwlDesign {
  palette: PaletteName;
  scheme: PaletteScheme;
  ears: EarStyle;
  /** Slot to accessory name, or null for deliberately empty. */
  wearing: Partial<Record<AccessorySlot, string | null>>;
}

const STORAGE_KEY = "gryt.owlDesign";

/** How a slot is labelled to somebody who has never read the code. */
const SLOT_LABEL: Record<AccessorySlot, string> = {
  expression: "Expression",
  eyewear: "Glasses",
  head: "Head",
  neck: "Neck",
  body: "Clothes",
};

function loadOwlDesign(): OwlDesign | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OwlDesign) : null;
  } catch {
    return null;
  }
}

function saveOwlDesign(design: OwlDesign) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(design));
  } catch {
    // A full or blocked storage costs the editor its memory of last time and
    // nothing else. Not worth telling anybody about.
  }
}

function startingDesign(): OwlDesign {
  return (
    loadOwlDesign() ?? {
      // Not the palette their name happens to hash to. Someone opening this is
      // choosing, and starting on a specific colour reads as a choice already
      // made on their behalf.
      palette: PALETTE_NAMES[0],
      scheme: "day",
      ears: "tufts",
      wearing: {},
    }
  );
}

/**
 * The chosen owl as a PNG, at the size an avatar is actually displayed.
 *
 * Rendered through an <img> and a canvas rather than by hand, so the browser
 * rasterises the same SVG it would have drawn on screen.
 */
async function renderToPng(seed: string, design: OwlDesign, size = 512): Promise<Blob> {
  const svg = owlAvatarDataUri(seed, { ...design, size });

  const image = new Image();
  image.decoding = "sync";
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
            Gryt draws you an owl from your name. Choose how it looks, or use
            a picture instead.
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
              <span className="text-sm font-semibold text-gryt-text">
                Design your owl
              </span>
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
              <span className="text-sm font-semibold text-gryt-text">
                Upload a picture
              </span>
              <span className="text-xs text-gryt-muted">
                PNG, JPG, WebP or GIF.
              </span>
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
  onSave: (png: Blob, design: OwlDesign) => void;
}) {
  const seed = avatarSeed(nickname) ?? "";
  const [design, setDesign] = useState<OwlDesign>(() => startingDesign());

  useEffect(() => {
    if (open) setDesign(startingDesign());
  }, [open]);

  const preview = useMemo(
    () => (seed ? owlAvatarDataUri(seed, { ...design, size: 256 }) : undefined),
    [seed, design],
  );

  const set = useCallback(<K extends keyof OwlDesign>(key: K, value: OwlDesign[K]) => {
    setDesign((current) => ({ ...current, [key]: value }));
  }, []);

  const wear = useCallback((slot: AccessorySlot, name: string | null) => {
    setDesign((current) => ({
      ...current,
      wearing: { ...current.wearing, [slot]: name },
    }));
  }, []);

  const handleSave = useCallback(async () => {
    saveOwlDesign(design);
    onSave(await renderToPng(seed, design), design);
  }, [design, seed, onSave]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup className="w-[42rem] max-w-[calc(100vw-2rem)]">
          <Dialog.Title>Design your owl</Dialog.Title>
          <Dialog.Description className="mt-2 mb-4">
            What you choose here is saved as your avatar picture.
          </Dialog.Description>

          <div className="flex flex-col gap-6 sm:flex-row">
            <div className="flex shrink-0 flex-col items-center gap-2">
              <Avatar className="h-40 w-40" size="large" src={preview} />
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Field label="Colour">
                <Choices
                  value={design.palette}
                  options={PALETTE_NAMES.map((n) => ({ value: n, label: n }))}
                  onChange={(v) => set("palette", v as PaletteName)}
                />
              </Field>
              <Field label="Time of day">
                <Choices
                  value={design.scheme}
                  options={PALETTE_SCHEMES.map((n) => ({ value: n, label: n }))}
                  onChange={(v) => set("scheme", v as PaletteScheme)}
                />
              </Field>
              <Field label="Ears">
                <Choices
                  value={design.ears}
                  options={EAR_STYLES.map((n) => ({ value: n, label: n }))}
                  onChange={(v) => set("ears", v as EarStyle)}
                />
              </Field>

              {ACCESSORY_SLOTS.map((slot) => (
                <Field key={slot} label={SLOT_LABEL[slot]}>
                  <Choices
                    value={design.wearing[slot] ?? ""}
                    options={[
                      { value: "", label: "Nothing" },
                      ...accessoriesIn(slot).map((a) => ({
                        value: a.name,
                        label: a.name.replace(/-/g, " "),
                      })),
                    ]}
                    onChange={(v) => wear(slot, v === "" ? null : v)}
                  />
                </Field>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button
              disabled={saving}
              onClick={() => onOpenChange(false)}
              size="small"
              tone="neutral"
            >
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void handleSave()} size="small">
              {saving ? "Saving..." : "Use this owl"}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-20 shrink-0 text-xs text-gryt-muted">{label}</span>
      {children}
    </label>
  );
}

/* A plain select for now. The shape of these is the part to design; the
   plumbing behind them is what this change is proving works. */
function Choices({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      className="min-w-0 flex-1"
      onValueChange={(v) => onChange(String(v))}
      options={options}
      size="small"
      value={value}
    />
  );
}
