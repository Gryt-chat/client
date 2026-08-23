/**
 * The hotkey combo grammar, shared by the settings UI, the renderer's
 * listeners and the Electron main process.
 *
 * A combo is zero or more modifiers and exactly one base token, joined with
 * "+":
 *
 *   Ctrl+Shift+KeyM   a keyboard key, named by DOM `KeyboardEvent.code`
 *   Alt+Mouse4        a mouse button
 *
 * Mouse buttons are numbered by the physical button the way mice, games and
 * every other voice app number them — Mouse1 left, Mouse2 right, Mouse3
 * middle, Mouse4 and Mouse5 the side buttons. The DOM numbers them
 * differently (middle is 1, right is 2), and libuiohook agrees with the
 * physical numbering, so the DOM is the odd one out and gets translated here.
 *
 * Combos are persisted as these strings, so changing a token changes what
 * people already have bound.
 */

/**
 * The event shapes this works on, spelled out rather than taken from the DOM.
 * The Electron main process reads the same grammar and compiles without the
 * DOM lib, and uiohook's events are not DOM events anyway.
 */
export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface MouseLike {
  button: number;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/** Everything a hotkey can be bound to. */
export type HotkeyAction = "ptt" | "mute" | "deafen" | "disconnect";

export const HOTKEY_ACTIONS: HotkeyAction[] = ["ptt", "mute", "deafen", "disconnect"];

export type HotkeyBindings = Record<HotkeyAction, string>;

const MODIFIER_CODES = [
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
];

/** DOM `MouseEvent.button` → the physical button number used in combos. */
const DOM_BUTTON_TO_MOUSE: Record<number, number> = { 0: 1, 1: 3, 2: 2, 3: 4, 4: 5 };

/**
 * Left and right click are deliberately not bindable.
 *
 * uiohook listens without swallowing the event, so a left-click binding would
 * key the microphone on every click anywhere in the OS — including the click
 * that binds it. Middle and the two side buttons are the ones people mean by
 * "mouse hotkey" anyway.
 */
export const BINDABLE_MOUSE_BUTTONS = [3, 4, 5];

function modifiersOf(e: KeyLike | MouseLike): string[] {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  if (e.metaKey) parts.push("Meta");
  return parts;
}

/** The base token of a combo — the key or button, without the modifiers. */
export function comboBase(combo: string): string {
  const parts = combo.split("+");
  return parts[parts.length - 1] ?? "";
}

export function isMouseToken(token: string): boolean {
  return /^Mouse[1-5]$/.test(token);
}

/** The physical button number a combo is bound to, or null if it is a key. */
export function comboMouseButton(combo: string): number | null {
  const base = comboBase(combo);
  return isMouseToken(base) ? Number(base.slice(5)) : null;
}

export function buildKeyCombo(e: KeyLike): string {
  const parts = modifiersOf(e);
  if (!MODIFIER_CODES.includes(e.code)) parts.push(e.code);
  return parts.join("+");
}

/**
 * Returns null for buttons that cannot be bound, so a caller can let the click
 * through instead of capturing it.
 */
export function buildMouseCombo(e: MouseLike): string | null {
  const button = DOM_BUTTON_TO_MOUSE[e.button];
  if (button === undefined || !BINDABLE_MOUSE_BUTTONS.includes(button)) return null;
  return [...modifiersOf(e), `Mouse${button}`].join("+");
}

export function formatCombo(combo: string): string {
  if (!combo) return "Not set";
  return combo
    .split("+")
    .map((part) => {
      switch (part) {
        case "Space": return "Space";
        case "Escape": return "Esc";
        default:
          if (part.startsWith("Key")) return part.slice(3);
          if (part.startsWith("Digit")) return part.slice(5);
          if (isMouseToken(part)) return `Mouse ${part.slice(5)}`;
          return part;
      }
    })
    .join(" + ");
}

function modifiersMatch(e: KeyLike | MouseLike, combo: string): boolean {
  const parts = combo.split("+");
  return (
    e.ctrlKey === parts.includes("Ctrl") &&
    e.shiftKey === parts.includes("Shift") &&
    e.altKey === parts.includes("Alt") &&
    e.metaKey === parts.includes("Meta")
  );
}

export function matchesKeyEvent(e: KeyLike, combo: string): boolean {
  if (!combo) return false;
  const base = comboBase(combo);
  if (isMouseToken(base)) return false;
  return e.code === base && modifiersMatch(e, combo);
}

export function matchesMouseEvent(e: MouseLike, combo: string): boolean {
  if (!combo) return false;
  const button = comboMouseButton(combo);
  if (button === null) return false;
  return DOM_BUTTON_TO_MOUSE[e.button] === button && modifiersMatch(e, combo);
}

/**
 * A release is matched on the base alone. Someone who lets go of Shift before
 * the key would otherwise never release the binding, and the microphone would
 * stay open.
 */
export function releasesKeyEvent(e: KeyLike, combo: string): boolean {
  if (!combo) return false;
  const base = comboBase(combo);
  return !isMouseToken(base) && e.code === base;
}

export function releasesMouseEvent(e: MouseLike, combo: string): boolean {
  const button = comboMouseButton(combo);
  return button !== null && DOM_BUTTON_TO_MOUSE[e.button] === button;
}

/**
 * A binding taken apart, for a listener that has to compare the pieces itself.
 * The Electron main process uses this to turn a stored combo into something
 * uiohook can be matched against.
 */
export interface ParsedCombo {
  /** `KeyboardEvent.code` this is bound to, or null for a mouse binding. */
  code: string | null;
  /** Physical mouse button, or null for a key binding. */
  mouseButton: number | null;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export function parseCombo(combo: string): ParsedCombo | null {
  if (!combo) return null;

  const parts = combo.split("+");
  const base = parts[parts.length - 1];
  const modifiers = {
    ctrl: parts.includes("Ctrl"),
    shift: parts.includes("Shift"),
    alt: parts.includes("Alt"),
    meta: parts.includes("Meta"),
  };

  if (isMouseToken(base)) {
    return { code: null, mouseButton: Number(base.slice(5)), ...modifiers };
  }

  return { code: base, mouseButton: null, ...modifiers };
}
