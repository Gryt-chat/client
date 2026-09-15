/* eslint-env node */

/**
 * What a yes to "Were you here as a guest before?" shows, and how held messages
 * follow a guest the server merged into an account.
 */

import assert from "node:assert/strict";

const { claimOutcomeToast, expectClaimOutcome, takeClaimOutcome, CLAIM_OUTCOME_WAIT_MS } = await import(
  "../src/packages/lib/identityClaimOutcome.ts"
);
const { mergeSender, mergeSenders } = await import("../src/packages/socket/src/utils/mergeSender.ts");

// ── the toast for each answer the server can give ───────────────────

assert.equal(claimOutcomeToast("carried")?.tone, "success");
assert.equal(claimOutcomeToast("merged")?.tone, "success");
assert.match(claimOutcomeToast("merged")?.message ?? "", /keeps its name, picture and roles/);
assert.equal(claimOutcomeToast("no_prior_membership")?.tone, "info");
assert.equal(claimOutcomeToast("failed")?.tone, "error");

// A server from before the field says nothing, and neither does the client.
assert.equal(claimOutcomeToast(undefined), null);
assert.equal(claimOutcomeToast("account_already_member"), null);

// ── only the join right after the click gets one ────────────────────

assert.equal(takeClaimOutcome("a.example", 0), false, "nobody asked");

expectClaimOutcome("a.example", 1_000);
assert.equal(takeClaimOutcome("b.example", 1_500), false, "another server's join is not the answer");
assert.equal(takeClaimOutcome("a.example", 1_500), true);
assert.equal(takeClaimOutcome("a.example", 1_600), false, "a rejoin afterwards reports the stored yes again");

expectClaimOutcome("a.example", 0);
assert.equal(takeClaimOutcome("a.example", CLAIM_OUTCOME_WAIT_MS + 1), false, "a join that came much later");

// ── held messages follow the merge ──────────────────────────────────

const guest = "user_guest";
const account = "user_account";
const other = "user_other";

const message = (id, sender, reactions = null) => ({
  conversation_id: "general",
  message_id: id,
  sender_server_id: sender,
  text: id,
  attachments: null,
  created_at: "2026-09-15T10:00:00.000Z",
  reactions,
});

{
  const sent = mergeSender(message("m1", guest), guest, account);
  assert.equal(sent.sender_server_id, account);
}

{
  const both = mergeSender(
    message("m2", other, [
      { src: "👍", amount: 3, users: [guest, other, account] },
      { src: "🎉", amount: 1, users: [guest] },
      { src: "👀", amount: 1, users: [other] },
    ]),
    guest,
    account,
  );
  assert.deepEqual(both.reactions?.[0], { src: "👍", amount: 2, users: [account, other] }, "somebody who reacted as both counts once");
  assert.deepEqual(both.reactions?.[1], { src: "🎉", amount: 1, users: [account] });
  assert.equal(both.sender_server_id, other);
}

{
  const untouched = message("m3", other, [{ src: "👀", amount: 1, users: [other] }]);
  assert.equal(mergeSender(untouched, guest, account), untouched, "a row that never named the guest keeps its identity");

  const list = [untouched, message("m4", other)];
  assert.equal(mergeSenders(list, guest, account), list, "so does a list with nothing to change");

  const mixed = [untouched, message("m5", guest)];
  const merged = mergeSenders(mixed, guest, account);
  assert.notEqual(merged, mixed);
  assert.equal(merged[0], untouched);
  assert.equal(merged[1].sender_server_id, account);
}

console.log("identity claim: outcome toasts and merged senders behave");
