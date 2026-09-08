/* eslint-env node */

// The member hover card's open state has to live above the grouping, or somebody
// going offline moves their row and takes the open card with it. GRYT-1067.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = join(HERE, "..", "src/packages/socket/src/components/MemberSidebar.tsx");
const sidebar = readFileSync(SIDEBAR, "utf8");

// The premise: each group is its own <section>, so a member changing group changes
// their row's parent, and React remounts it. Nothing else needs the state lifted.
assert.match(
  sidebar,
  /groups\.map\([\s\S]{0,400}?<section/,
  `${SIDEBAR} no longer renders a section per group. If a row can no longer change ` +
    "parent, this check and the lifted card state are both dead weight — say so.",
);

// A row keyed inside its own section is remounted when the section changes, which
// is what loses an uncontrolled card.
assert.match(
  sidebar,
  /key=\{member\.serverUserId\}/,
  `${SIDEBAR} no longer keys member rows by serverUserId`,
);

// The card is controlled, and the state that controls it sits in the list.
assert.match(
  sidebar,
  /<PreviewCard\.Root\s+open=\{cardOpen\}\s+onOpenChange=\{onCardOpenChange\}>/,
  `${SIDEBAR}'s PreviewCard is uncontrolled again, so a member changing group closes ` +
    "an open card",
);

const openState = sidebar.match(/const \[openCardFor, setOpenCardFor\] = useState<[^>]*>\([^)]*\);/);
assert.ok(
  openState,
  `${SIDEBAR} no longer holds openCardFor. The open state has to be above the groups, ` +
    "not inside the row that moves between them.",
);

// Above the groups, not inside MemberItem: `const MemberItem` comes first in the
// file, so the state landing before it means it went back into the row.
assert.ok(
  sidebar.indexOf(openState[0]) > sidebar.indexOf("const MemberItem"),
  "openCardFor is declared inside MemberItem, which is the component that remounts",
);

/** The updater, run for real: only one card open, and closing is not a free-for-all. */
function reducer() {
  const source = sidebar.match(/setOpenCardFor\(\s*\(current\) =>[\s\S]*?\)\s*,/);
  assert.ok(source, `${SIDEBAR}'s setCardOpen no longer updates from the previous value`);
  const arrow = source[0].slice(source[0].indexOf("(current)"), source[0].lastIndexOf(")"));
  return new Function(`return (${arrow});`)();
}

const apply = (current, id, open) => {
  let next = current;
  const setOpenCardFor = (fn) => (next = fn(current));
  new Function(
    "setOpenCardFor",
    "serverUserId",
    "open",
    `setOpenCardFor(${reducer().toString()});`,
  )(setOpenCardFor, id, open);
  return next;
};

assert.equal(apply(null, "a", true), "a", "opening a card does not record it");
assert.equal(apply("a", "a", false), null, "closing the open card does not clear it");
assert.equal(apply("a", "b", true), "b", "opening another card does not replace the first");
assert.equal(
  apply("a", "b", false),
  "a",
  "a stale row reporting closed took down the card that is actually open",
);

console.log("member card state: ok, lifted above the groups, one card at a time");
