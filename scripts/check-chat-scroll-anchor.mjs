/* eslint-env node */

// Runs useChatScroll's own ResizeObserver effect against a fake scroller, so a
// message hidden behind the not-encrypted warning fails here. GRYT-1067.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src/packages/socket/src/hooks/useChatScroll.ts",
);
const source = readFileSync(SOURCE, "utf8");

/** The effect that holds the bottom, from its arrow's brace to the match. */
function holdTheBottomEffect(text) {
  const anchor = text.indexOf('if (!el || typeof ResizeObserver === "undefined") return;');
  assert.notEqual(
    anchor,
    -1,
    `${SOURCE} no longer has the ResizeObserver that holds the scroll at the bottom. ` +
      "If it moved or was renamed, move this check with it.",
  );
  const OPENER = "useEffect(() => {";
  const opener = text.lastIndexOf(OPENER, anchor);
  assert.notEqual(opener, -1, `the ResizeObserver in ${SOURCE} is not inside a useEffect`);
  const start = opener + OPENER.length - 1;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in the hold-the-bottom effect in ${SOURCE}`);
}

// TypeScript's only contribution to this effect is one generic on querySelectorAll.
const body = holdTheBottomEffect(source).replace("<HTMLElement>", "");

/**
 * Three rows, scrolled to the bottom. `shrinkBy` takes height off the viewport
 * the way an element appearing above the composer does.
 */
function fakeScroller() {
  const observed = [];
  const rows = [1, 2, 3].map((n) => ({ row: n }));
  const callbacks = [];
  let scrollTop = 300;
  const el = {
    scrollHeight: 900,
    clientHeight: 600,
    // Clamped, the way a real element is: writing past the end lands at the end.
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(v) {
      scrollTop = Math.max(0, Math.min(v, this.scrollHeight - this.clientHeight));
    },
    querySelectorAll: () => rows,
    shrinkBy(px) {
      this.clientHeight -= px;
      for (const cb of callbacks.slice()) cb();
    },
  };

  class FakeResizeObserver {
    constructor(cb) {
      this.cb = cb;
      callbacks.push(cb);
    }
    observe(target) {
      observed.push(target);
    }
    disconnect() {
      const i = callbacks.indexOf(this.cb);
      if (i !== -1) callbacks.splice(i, 1);
    }
  }

  return { el, rows, observed, FakeResizeObserver };
}

function run({ atBottom }) {
  const { el, rows, observed, FakeResizeObserver } = fakeScroller();
  const cleanup = new Function(
    "scrollRef",
    "isAtBottomRef",
    "ResizeObserver",
    `return (() => ${body})();`,
  )({ current: el }, { current: atBottom }, FakeResizeObserver);
  return { el, rows, observed, cleanup };
}

// The container itself has to be observed. Watching only the rows is the bug:
// the warning appearing resizes neither of them.
{
  const { el, rows, observed } = run({ atBottom: true });
  assert.ok(
    observed.includes(el),
    "the scroll container is not observed, so anything appearing between the messages " +
      "and the composer shrinks it without re-pinning and the newest message is hidden",
  );
  for (const row of rows) {
    assert.ok(observed.includes(row), "the message rows are no longer observed");
  }
}

// Shrinking the viewport while at the bottom pins back to the bottom.
{
  const { el } = run({ atBottom: true });
  el.shrinkBy(40);
  assert.equal(
    el.scrollHeight - el.scrollTop - el.clientHeight,
    0,
    "the warning appearing left the scroller off the bottom, so the last message sits behind it",
  );
}

// Somebody reading further up is not yanked to the bottom by it.
{
  const { el } = run({ atBottom: false });
  const before = el.scrollTop;
  el.shrinkBy(40);
  assert.equal(el.scrollTop, before, "a reader scrolled up was pulled to the bottom by a resize");
}

// And the observer is torn down, or every message would leave one behind.
{
  const { el, cleanup } = run({ atBottom: true });
  cleanup();
  el.scrollTop = 0;
  el.shrinkBy(40);
  assert.equal(el.scrollTop, 0, "the effect does not disconnect its observer");
}

console.log("chat scroll anchor: ok, container observed, re-pins on resize, only when at bottom");
