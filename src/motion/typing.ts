import { typed } from "./caret";
import { sfx } from "./sfx";
import { rand, wait } from "./stage";

/** Types into whatever has focus the way a keyboard would, so Lexical's shortcuts and autocompletes fire. */
export async function type(text: string, perChar = 55) {
  for (const ch of text) {
    sfx("key");
    typed();
    document.execCommand("insertText", false, ch);
    await wait(perChar * (0.6 + rand() * 0.8) + (ch === " " ? perChar * 0.6 : 0));
  }
}

/** Fills a React-controlled input one character at a time. */
export async function typeInput(input: HTMLInputElement, text: string, perChar = 55) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (let i = 1; i <= text.length; i++) {
    sfx("key");
    typed();
    setter.call(input, text.slice(0, i));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(perChar * (0.6 + rand() * 0.8));
  }
}

export function key(el: Element, k: string) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: k, bubbles: true, cancelable: true }));
}

/** Selects `text` inside `root` up to `upTo` characters, the way a drag across it would. */
export function selectText(root: Element, text: string, upTo = text.length) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const i = node.textContent?.indexOf(text) ?? -1;
    if (i < 0) continue;
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + upTo);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    return range;
  }
  throw new Error(`motion: "${text}" is not in the editor`);
}
