/* eslint-env node */

// Nothing is posted before this device agrees to the terms, and agreeing posts once.
// The e2e suite covers the composer; this covers storage failing and answering late. GRYT-1275.

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const {
  TERMS_URL,
  GUIDELINES_URL,
  TERMS_VERSION,
  TERMS_STORAGE_KEY,
  agreementAt,
  coversTerms,
  createTermsGate,
  parseAgreement,
} = await import(pathToFileURL(join(root, "src/lib/termsAgreement.ts")).href);

// ── what is asked about ─────────────────────────────────────────────

assert.equal(TERMS_URL, "https://gryt.chat/terms");
assert.equal(GUIDELINES_URL, "https://gryt.chat/community-guidelines");
assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/, "the version is the pages' Last updated date");
assert.equal(TERMS_STORAGE_KEY, "gryt.termsAgreement", "renaming the key asks everybody again");

// ── reading what storage held ───────────────────────────────────────

for (const [raw, why] of [
  [null, "nothing stored"],
  ["", "an empty string"],
  ["{not json", "a broken write"],
  ["42", "a number"],
  ['"2026-09-03"', "a bare version"],
  ["[]", "an array"],
  ['{"agreedAt":"2026-09-16T10:00:00.000Z"}', "no version"],
  ['{"version":"latest","agreedAt":"2026-09-16T10:00:00.000Z"}', "a version that is not a date"],
  ['{"version":"2026-09-03"}', "no time"],
]) {
  assert.equal(parseAgreement(raw), null, `${why} reads as an agreement`);
}

assert.deepEqual(
  parseAgreement('{"version":"2026-09-03","agreedAt":"2026-09-16T10:00:00.000Z","extra":true}'),
  { version: "2026-09-03", agreedAt: "2026-09-16T10:00:00.000Z" },
);

assert.equal(coversTerms(null), false);
assert.equal(coversTerms({ version: TERMS_VERSION, agreedAt: "x" }), true);
assert.equal(coversTerms({ version: "2026-09-02", agreedAt: "x" }, "2026-09-03"), false, "older terms cover newer ones");
assert.equal(coversTerms({ version: "2026-10-01", agreedAt: "x" }, "2026-09-03"), true, "a downgrade asks again");

assert.deepEqual(agreementAt(new Date("2026-09-16T10:00:00.000Z"), "2026-09-03"), {
  version: "2026-09-03",
  agreedAt: "2026-09-16T10:00:00.000Z",
});

// ── the gate, over storage that answers at once ─────────────────────

const NOW = new Date("2026-09-16T10:00:00.000Z");

function syncStorage(initial = null) {
  const storage = {
    value: initial,
    reads: 0,
    writes: [],
    read() {
      storage.reads++;
      return storage.value;
    },
    write(value) {
      storage.writes.push(value);
      storage.value = value;
    },
  };
  return storage;
}

function counter() {
  const post = () => post.calls++;
  post.calls = 0;
  return post;
}

{
  const storage = syncStorage();
  const gate = createTermsGate(storage, "2026-09-03", () => NOW);
  let heard = 0;
  gate.subscribe(() => heard++);

  const first = counter();
  gate.postAfterAgreeing(first);
  assert.equal(first.calls, 0, "a device that never agreed posted");
  assert.equal(gate.asking(), true, "nothing asked");
  assert.equal(heard, 1, "the prompt was not told to open");

  gate.decline();
  assert.equal(gate.asking(), false, "Not now left the prompt open");
  assert.equal(first.calls, 0, "Not now posted anyway");
  assert.deepEqual(storage.writes, [], "Not now was remembered");

  const second = counter();
  gate.postAfterAgreeing(second);
  assert.equal(gate.asking(), true, "the next post after Not now did not ask");
  gate.agree();
  assert.equal(second.calls, 1, "Agree did not post what was waiting");
  assert.equal(first.calls, 0, "a declined post went out after all");
  assert.equal(gate.asking(), false);
  assert.deepEqual(JSON.parse(storage.writes[0]), { version: "2026-09-03", agreedAt: NOW.toISOString() });

  const reads = storage.reads;
  const third = counter();
  gate.postAfterAgreeing(third);
  assert.equal(third.calls, 1, "a post after agreeing waited");
  assert.equal(storage.reads, reads, "storage is read again after agreeing");

  const relaunched = createTermsGate(syncStorage(storage.value), "2026-09-03");
  const afterRestart = counter();
  relaunched.postAfterAgreeing(afterRestart);
  assert.equal(afterRestart.calls, 1, "the agreement did not survive a restart");

  const newerTerms = createTermsGate(syncStorage(storage.value), "2026-12-01");
  const underNewTerms = counter();
  newerTerms.postAfterAgreeing(underNewTerms);
  assert.equal(underNewTerms.calls, 0, "new terms did not ask again");
  assert.equal(newerTerms.asking(), true);
}

// A post that was answered stays answered when storage is read again.
{
  const gate = createTermsGate(syncStorage(), "2026-09-03");
  const declined = counter();
  gate.postAfterAgreeing(declined);
  gate.decline();
  gate.load();
  assert.equal(gate.asking(), false, "reading storage again reopened a prompt somebody said Not now to");
  assert.equal(declined.calls, 0);

  const agreed = counter();
  gate.postAfterAgreeing(agreed);
  gate.agree();
  gate.load();
  assert.equal(agreed.calls, 1, "reading storage again sent the message twice");
}

// Another window agreeing counts, since storage is read each time until this one knows.
{
  const storage = syncStorage();
  const gate = createTermsGate(storage, "2026-09-03");
  gate.postAfterAgreeing(counter());
  gate.decline();
  storage.value = JSON.stringify({ version: "2026-09-03", agreedAt: NOW.toISOString() });
  const post = counter();
  gate.postAfterAgreeing(post);
  assert.equal(post.calls, 1, "an agreement made in another window was ignored");
}

// Storage that throws: ask, and after Agree don't ask again in a loop.
{
  const gate = createTermsGate(
    {
      read() {
        throw new Error("SecurityError");
      },
      write() {
        throw new Error("QuotaExceededError");
      },
    },
    "2026-09-03",
  );
  const post = counter();
  gate.postAfterAgreeing(post);
  assert.equal(post.calls, 0, "unreadable storage counted as agreeing");
  gate.agree();
  assert.equal(post.calls, 1, "a failed write stopped the post");
  const again = counter();
  gate.postAfterAgreeing(again);
  assert.equal(again.calls, 1, "a failed write asked again straight away");
}

// ── the gate, over storage that answers later ───────────────────────

function asyncStorage(value) {
  const storage = {
    reads: 0,
    read() {
      storage.reads++;
      return Promise.resolve(value);
    },
    write: async () => {},
  };
  return storage;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

{
  const agreed = JSON.stringify({ version: "2026-09-03", agreedAt: NOW.toISOString() });
  const storage = asyncStorage(agreed);
  const gate = createTermsGate(storage, "2026-09-03");
  const tap = counter();
  const doubleTap = counter();
  gate.postAfterAgreeing(tap);
  gate.postAfterAgreeing(doubleTap);
  assert.equal(tap.calls + doubleTap.calls, 0, "posted before storage answered");
  await settled();
  assert.equal(storage.reads, 1, "two taps read storage twice");
  assert.equal(doubleTap.calls, 1, "the post did not go out once storage answered");
  assert.equal(tap.calls, 0, "two taps before storage answered sent the message twice");
  assert.equal(gate.asking(), false, "a device that agreed was asked");
}

{
  const gate = createTermsGate(asyncStorage(null), "2026-09-03");
  const post = counter();
  gate.postAfterAgreeing(post);
  await settled();
  assert.equal(gate.asking(), true, "late storage with nothing in it did not ask");
  gate.agree();
  assert.equal(post.calls, 1);
}

{
  const agreed = JSON.stringify({ version: "2026-09-03", agreedAt: NOW.toISOString() });
  const gate = createTermsGate(asyncStorage(agreed), "2026-09-03");
  gate.load();
  await settled();
  const post = counter();
  gate.postAfterAgreeing(post);
  assert.equal(post.calls, 1, "load() did not make the first post immediate");
}

{
  const gate = createTermsGate({ read: () => Promise.reject(new Error("gone")), write: async () => {} }, "2026-09-03");
  const post = counter();
  gate.postAfterAgreeing(post);
  await settled();
  assert.equal(post.calls, 0, "storage that failed later counted as agreeing");
  assert.equal(gate.asking(), true);
}

console.log("terms agreement: ok");
