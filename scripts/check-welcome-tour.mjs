/* eslint-env node */

// "Show me around" on the welcome did nothing. The settings load seeds a random
// nickname before anybody can click, and the button only started the tour without one.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "src/packages/settings/src/hooks/useSettings.ts";
const plain = stripTypeScriptTypes(readFileSync(join(root, SOURCE), "utf8"));

/** A function declaration's body, from its brace to the one that closes it. */
function bodyOf(signature) {
  const at = plain.indexOf(signature);
  assert.notEqual(at, -1, `${SOURCE} no longer has "${signature}". Move this check with it.`);
  const start = plain.indexOf("{", at + signature.length);
  let depth = 0;
  for (let i = start; i < plain.length; i++) {
    if (plain[i] === "{") depth++;
    else if (plain[i] === "}" && --depth === 0) return plain.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after "${signature}" in ${SOURCE}`);
}

const completeWelcome = bodyOf("function completeWelcome(");

/* completeWelcome run against a user store, with the state setters recording what
   they were given. `stored` is what the settings load left behind. */
function run(stored, options) {
  const values = new Map(Object.entries(stored));
  const state = { showTour: false, hasSeenWelcome: false, welcomeWritten: false };
  new Function(
    "options",
    "setHasSeenWelcome",
    "writeSeenWelcome",
    "setShowTour",
    "getUserValue",
    "setUserValue",
    completeWelcome,
  )(
    options,
    (v) => (state.hasSeenWelcome = v),
    () => (state.welcomeWritten = true),
    (v) => (state.showTour = v),
    (key, fallback) => (values.has(key) ? values.get(key) : fallback),
    (key, value) => values.set(key, value),
  );
  return { ...state, hasSeenTour: values.get("hasSeenTour") ?? false };
}

// The load writes a random name for a new install, so this is what a first run
// actually looks like when the button is pressed.
const firstRun = { nickname: "Iron" };

{
  const after = run(firstRun, { startTour: true });
  assert.equal(after.showTour, true, "Show me around on a first run should start the tour");
  assert.equal(after.hasSeenWelcome, true);
  assert.equal(after.welcomeWritten, true, "the welcome should be written down as seen");
  assert.equal(after.hasSeenTour, false, "starting the tour is not finishing it");
}

// Somebody greeted again on a new device, who took the tour somewhere else. They
// asked for it, so they get it.
{
  const after = run({ nickname: "Iron", hasSeenTour: true }, { startTour: true });
  assert.equal(after.showTour, true, "asking for the tour should start it even if it was seen before");
}

// "I'll look myself" declines, and says so for the next launch.
{
  const after = run(firstRun);
  assert.equal(after.showTour, false, "declining should not start the tour");
  assert.equal(after.hasSeenTour, true, "declining should be written down");
  assert.equal(after.welcomeWritten, true);
}

// Wired straight to an event handler, it gets an event where the options would be.
// That is a skip.
{
  const after = run(firstRun, { reason: "escape-key", cancel: () => {} });
  assert.equal(after.showTour, false, "closing the dialog should not start the tour");
  assert.equal(after.hasSeenTour, true);
}

// The button has to be wired to the path above.
{
  const welcome = readFileSync(join(root, "src/components/welcome.tsx"), "utf8");
  assert.match(
    welcome,
    /onClick=\{\(\) => completeWelcome\(\{ startTour: true \}\)\}\s*>\s*Show me around/,
    "Show me around should call completeWelcome({ startTour: true })",
  );
  const mainApp = readFileSync(join(root, "src/components/mainApp.tsx"), "utf8");
  assert.match(
    mainApp,
    /\{showTour && <OnboardingTour onFinish=\{dismissTour\} \/>\}/,
    "the tour should mount on showTour",
  );
}

console.log("welcome tour: ok");
