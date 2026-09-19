/* eslint-env node */

/**
 * Confirmations are drawn by one component, alerts by one other. Twenty-two
 * hand-rolled copies drifted; each new one is where it starts again.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/* The ones allowed to reach for AlertDialog, being what it is for. WhatsNewDialog
   left the list in GRYT-1145: it closes on an outside click now, so it is a Dialog. */
const PRIMITIVES = [
  "packages/socket/src/components/ConfirmDialog.tsx",
  "packages/socket/src/components/NoticeDialog.tsx",
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(src);

const offenders = files
  .filter((file) => readFileSync(file, "utf8").includes("AlertDialog.Root"))
  .map((file) => relative(src, file).split("\\").join("/"))
  .filter((file) => !PRIMITIVES.includes(file));

assert.deepEqual(
  offenders,
  [],
  `these build a dialog by hand instead of using ConfirmDialog or NoticeDialog:\n  ${offenders.join("\n  ")}`,
);

// And the primitives themselves are still there to be used.
for (const file of PRIMITIVES) {
  const body = readFileSync(join(src, file), "utf8");
  assert.ok(body.includes("AlertDialog.Root"), `${file} no longer renders a dialog`);
}

/* ── Widths and button rows ────────────────────────────────────────── */

// A popup's width is a w-[…] class. Its own max-w-[calc(100vw-3rem)] keeps it inside the
// window, and an inline maxWidth or a max-w class replaces that cap (GRYT-1212).
const POPUPS = new Set(["Dialog.Popup", "AlertDialog.Popup"]);

const tag = (node) => node.tagName.getText();

function opening(node) {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

function attribute(element, name) {
  return element.attributes.properties.find(
    (prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name,
  );
}

function everyNode(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => everyNode(child, visit));
}

/** Every class token in a className, from string literals, templates and cn() calls. */
function classTokens(attr) {
  const tokens = [];
  if (!attr?.initializer) return tokens;
  everyNode(attr.initializer, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      tokens.push(...node.text.split(/\s+/));
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      tokens.push(...node.text.split(/\s+/));
    }
  });
  return tokens.filter(Boolean);
}

/** The utility with its variants taken off: `sm:max-w-md` is `max-w-md`. */
function utility(token) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i++) {
    if (token[i] === "[") depth++;
    else if (token[i] === "]") depth--;
    else if (token[i] === ":" && depth === 0) cut = i + 1;
  }
  return token.slice(cut);
}

function styleKeys(attr) {
  const keys = [];
  if (!attr?.initializer) return keys;
  everyNode(attr.initializer, (node) => {
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      keys.push(node.name.getText().replace(/^["']|["']$/g, ""));
    }
  });
  return keys;
}

function containsButton(node) {
  let found = false;
  everyNode(node, (child) => {
    const el = opening(child);
    if (el && tag(el) === "Button") found = true;
  });
  return found;
}

/** How many of a row's own children hold a button, a group of them counting as one. */
function buttonsIn(row) {
  let count = 0;
  for (const child of row.children) {
    if (ts.isJsxExpression(child) ? child.expression && containsButton(child.expression) : opening(child) && containsButton(child)) {
      count++;
    }
  }
  return count;
}

const problems = [];

for (const file of files.filter((f) => f.endsWith(".tsx"))) {
  const text = readFileSync(file, "utf8");
  if (!text.includes(".Popup")) continue;
  const name = relative(src, file).split("\\").join("/");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (node) => `${name}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  everyNode(sf, (node) => {
    const popup = opening(node);
    if (!popup || !POPUPS.has(tag(popup))) return;

    for (const key of styleKeys(attribute(popup, "style"))) {
      if (/^(maxWidth|minWidth|max-width|min-width)$/.test(key)) {
        problems.push(`${at(popup)} sets ${key} inline on ${tag(popup)}. Use a w-[…] class instead.`);
      }
    }
    for (const token of classTokens(attribute(popup, "className"))) {
      const u = utility(token);
      if (u.startsWith("min-w-") || (u.startsWith("max-w-") && !u.includes("vw"))) {
        problems.push(`${at(popup)} has ${token} on ${tag(popup)}, which lets it run past a narrow window.`);
      }
      if (u === "overflow-hidden") {
        problems.push(
          `${at(popup)} has ${token} on ${tag(popup)}, which overrides the shared dialog's vertical scrolling. Use overflow-x-hidden if only horizontal clipping is intended.`,
        );
      }
    }

    if (!ts.isJsxElement(node)) return;
    everyNode(node, (inner) => {
      if (!ts.isJsxElement(inner)) return;
      const element = tag(inner.openingElement);
      const tokens = classTokens(attribute(inner.openingElement, "className"));
      if (!/\.Footer$/.test(element) && !(/^[a-z]+$/.test(element) && tokens.map(utility).includes("flex"))) return;
      if (buttonsIn(inner) < 2) return;
      // Unprefixed only: `sm:flex-wrap` still leaves the narrowest window a row that can't wrap.
      if (tokens.some((token) => ["flex-wrap", "flex-col", "flex-col-reverse"].includes(token))) return;
      problems.push(`${at(inner)} puts buttons in a row that cannot wrap. Add flex-wrap.`);
    });
  });
}

assert.deepEqual(problems, [], `dialogs that can run off a narrow window:\n  ${problems.join("\n  ")}`);

console.log(`dialog primitives: ok, ${PRIMITIVES.length} of them and nothing else; every dialog fits the window`);
