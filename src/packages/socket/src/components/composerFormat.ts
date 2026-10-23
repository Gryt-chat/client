export type ComposerFormat = "bold" | "italic" | "strike" | "code" | "link" | "h1" | "h2" | "h3" | "list" | "quote";

const WRAP: Partial<Record<ComposerFormat, [string, string]>> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  strike: ["~~", "~~"],
  code: ["`", "`"],
  link: ["[", "]()"],
};

const LINE_PREFIX: Partial<Record<ComposerFormat, string>> = { h1: "# ", h2: "## ", h3: "### ", list: "- ", quote: "> " };
const HEADINGS = new Set(["# ", "## ", "### "]);

/** The marker a line starts with. A wrap starting there goes after it, or the line stops being a heading. */
const LINE_MARKER = /^(#{1,6} |> |- |\d+\. )/;

/** The box as one string, the way the message is sent: mention pills count as their text. */
function textOf(editor: HTMLElement): string {
  return editor.textContent ?? "";
}

function offsetOf(editor: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.setStart(editor, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

/** The DOM point at a string offset, preferring the start of a text node over the end of the one before. */
function pointAt(editor: HTMLElement, offset: number): [Node, number] {
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let last: Text | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (offset < seen + n.length) return [n, offset - seen];
    seen += n.length;
    last = n;
  }
  return last ? [last, last.length] : [editor, editor.childNodes.length];
}

export function selectComposerOffsets(editor: HTMLElement, start: number, end: number): void {
  const [a, ao] = pointAt(editor, start);
  const [b, bo] = pointAt(editor, end);
  window.getSelection()?.setBaseAndExtent(a, ao, b, bo);
}

/** insertText drops "\n" here, so line breaks go in the way Shift+Enter puts them in. */
function typeAt(editor: HTMLElement, offset: number, text: string) {
  selectComposerOffsets(editor, offset, offset);
  text.split("\n").forEach((part, i) => {
    if (i > 0) document.execCommand("insertLineBreak");
    if (part) document.execCommand("insertText", false, part);
  });
}

function deleteAt(editor: HTMLElement, offset: number, length: number) {
  selectComposerOffsets(editor, offset, offset + length);
  document.execCommand("delete");
}

function selected(editor: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0);
  return { start: offsetOf(editor, r.startContainer, r.startOffset), end: offsetOf(editor, r.endContainer, r.endOffset) };
}

/** Where each line the selection touches starts, last first so an edit doesn't move the ones still to do. */
function lineStarts(text: string, start: number, end: number): number[] {
  const starts = [text.lastIndexOf("\n", start - 1) + 1];
  for (let i = text.indexOf("\n", start); i !== -1 && i < end; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts.reverse();
}

/** How many markers wrap the selection: `***x***` is both bold and italic. */
function wrappedBy(text: string, start: number, end: number, format: ComposerFormat): number {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const run = (s: string, ch: string, fromEnd: boolean) => {
    let n = 0;
    while (n < s.length && s[fromEnd ? s.length - 1 - n : n] === ch) n++;
    return n;
  };
  if (format === "bold" || format === "italic") {
    const n = Math.min(run(before, "*", true), run(after, "*", false));
    if (format === "bold") return n >= 2 ? 2 : 0;
    return n === 1 || n >= 3 ? 1 : 0;
  }
  if (format === "strike") return before.endsWith("~~") && after.startsWith("~~") ? 2 : 0;
  if (format === "code") return run(before, "`", true) === 1 && run(after, "`", false) === 1 ? 1 : 0;
  return 0;
}

/** The `(url)` right after a selected `[text]`, as offsets of the url inside it. */
function linkAfter(text: string, start: number, end: number): { urlStart: number; urlEnd: number } | null {
  if (text[start - 1] !== "[" || text[end] !== "]" || text[end + 1] !== "(") return null;
  const close = text.indexOf(")", end + 2);
  return close === -1 ? null : { urlStart: end + 2, urlEnd: close };
}

function lineHas(text: string, lineStart: number, prefix: string): boolean {
  return text.slice(lineStart).match(LINE_MARKER)?.[0] === prefix;
}

/** What the selection already has, for lighting up the bar's buttons. */
export function activeComposerFormats(editor: HTMLElement): Set<ComposerFormat> {
  const active = new Set<ComposerFormat>();
  const at = selected(editor);
  if (!at || at.start === at.end) return active;
  const text = textOf(editor);
  for (const f of ["bold", "italic", "strike", "code"] as const) if (wrappedBy(text, at.start, at.end, f)) active.add(f);
  if (linkAfter(text, at.start, at.end)) active.add("link");
  const lines = lineStarts(text, at.start, at.end);
  for (const [f, prefix] of Object.entries(LINE_PREFIX) as [ComposerFormat, string][]) {
    if (lines.every((l) => lineHas(text, l, prefix))) active.add(f);
  }
  return active;
}

/** Where a link's url sits, for the field that edits it. Null once the selection isn't a link. */
export function selectedLink(editor: HTMLElement): { urlStart: number; urlEnd: number; url: string } | null {
  const at = selected(editor);
  if (!at) return null;
  const text = textOf(editor);
  const link = linkAfter(text, at.start, at.end);
  return link && { ...link, url: text.slice(link.urlStart, link.urlEnd) };
}

/** Swaps the url while its field has focus, where execCommand would type into the field instead.
    Returns where the url now ends. */
export function setComposerLinkUrl(editor: HTMLElement, urlStart: number, urlEnd: number, url: string): number {
  const [a, ao] = pointAt(editor, urlStart);
  const [b, bo] = pointAt(editor, urlEnd);
  const r = document.createRange();
  r.setStart(a, ao);
  r.setEnd(b, bo);
  r.deleteContents();
  if (url) r.insertNode(document.createTextNode(url));
  editor.normalize();
  editor.dispatchEvent(new Event("input", { bubbles: true }));
  return urlStart + url.length;
}

/** Back in the box with the link's text selected. */
export function selectComposerLinkText(editor: HTMLElement, urlStart: number): void {
  const textEnd = urlStart - 2;
  editor.focus();
  selectComposerOffsets(editor, textOf(editor).lastIndexOf("[", textEnd) + 1, textEnd);
}

/** Adds the markdown, or takes it off if it's already there, and keeps the text selected so styles stack.
    insertText, not DOM edits: Ctrl+Z undoes it and mention pills stay pills. */
export function applyComposerFormat(editor: HTMLElement, format: ComposerFormat): void {
  editor.focus();
  const text = textOf(editor);
  const at = selected(editor) ?? { start: text.length, end: text.length };
  const { end } = at;
  let { start } = at;

  const prefix = LINE_PREFIX[format];
  if (prefix) {
    const lines = lineStarts(text, start, end);
    const remove = lines.every((l) => lineHas(text, l, prefix));
    for (const l of lines) {
      const had = text.slice(l).match(LINE_MARKER)?.[0];
      // A heading swaps for another heading; anything else nests, as markdown allows.
      if (had && (remove || (HEADINGS.has(had) && HEADINGS.has(prefix)))) deleteAt(editor, l, had.length);
      if (!remove) typeAt(editor, l, prefix);
    }
    const after = textOf(editor);
    const first = lines[lines.length - 1];
    let lastEnd = first - 1;
    for (let i = 0; i < lines.length; i++) {
      const nl = after.indexOf("\n", lastEnd + 1);
      lastEnd = nl === -1 ? after.length : nl;
    }
    selectComposerOffsets(editor, first, lastEnd);
    return;
  }

  const link = format === "link" ? linkAfter(text, start, end) : null;
  if (link) {
    deleteAt(editor, end, link.urlEnd + 1 - end);
    deleteAt(editor, start - 1, 1);
    selectComposerOffsets(editor, start - 1, end - 1);
    return;
  }

  const wrapped = wrappedBy(text, start, end, format);
  if (wrapped) {
    deleteAt(editor, end, wrapped);
    deleteAt(editor, start - wrapped, wrapped);
    selectComposerOffsets(editor, start - wrapped, end - wrapped);
    return;
  }

  const lead = text.slice(start, end).match(LINE_MARKER);
  if (lead && (start === 0 || text[start - 1] === "\n") && end - start > lead[0].length) start += lead[0].length;

  // Code across lines is a block: backticks around a line break don't make inline code.
  const [open, close] = format === "code" && text.slice(start, end).includes("\n") ? ["```\n", "\n```"] : WRAP[format] ?? ["", ""];
  typeAt(editor, end, close);
  typeAt(editor, start, open);
  selectComposerOffsets(editor, start + open.length, end + open.length);
}
