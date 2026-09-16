/* eslint-env node */

// Invite links, with and without a code (GRYT-1291). A link to an open server names only the host,
// and every place that reads one used to want both halves or showed nothing.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/* ── a window for invite.ts, which reads location and writes session storage ── */

function fakeWindow(url) {
  const parsed = new URL(url);
  const store = new Map();
  const replaced = [];
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const location = {
    href: parsed.href,
    origin: parsed.origin,
    pathname: parsed.pathname,
    search: parsed.search,
    hash: parsed.hash,
  };
  const history = { replaceState: (_s, _t, next) => replaced.push(next) };
  globalThis.window = { location, history, sessionStorage: storage };
  globalThis.sessionStorage = storage;
  return { store, replaced };
}

const {
  capturePendingInviteFromUrl,
  inviteLink,
  parseServerInput,
  readPendingInvite,
  writePendingInvite,
} = await import("../src/packages/common/src/utils/invite.ts");
const { isPublicHost, pickPublicHost } = await import("../src/packages/common/src/utils/shareableHost.ts");
const { hostedAdvertisement, openServerLink } = await import("../src/packages/common/src/utils/openServerLink.ts");
const { inviteDialogView } = await import("../src/packages/socket/src/lib/inviteDialog.ts");
const { readJoinPolicy } = await import("../src/packages/socket/src/hooks/useServerJoinPolicy.ts");

/* ── pasting a link ─────────────────────────────────────────────────────────── */

{
  // Core up to 0.6.0 answered gryt.chat for this, so Add a server looked up the site instead.
  assert.deepEqual(parseServerInput("https://gryt.chat/invite?host=community.gryt.chat"), { host: "community.gryt.chat", code: "" });
  assert.deepEqual(parseServerInput("gryt://invite?host=chat.example.com:5001"), { host: "chat.example.com:5001", code: "" });
  assert.deepEqual(parseServerInput("https://gryt.chat/invite?host=chat.example.com&code=ABC123"), { host: "chat.example.com", code: "abc123" });
  assert.deepEqual(parseServerInput("https://app.gryt.chat/invite/XYZ"), { host: "app.gryt.chat", code: "xyz" });
  assert.deepEqual(parseServerInput("https://app.gryt.chat/invite/XYZ?host=chat.example.com"), { host: "app.gryt.chat", code: "xyz" });
  assert.deepEqual(parseServerInput("chat.example.com"), { host: "chat.example.com", code: "" });
  assert.deepEqual(parseServerInput("https://gryt.chat/blog?host=chat.example.com"), { host: "gryt.chat", code: "" }, "only an invite path is an invite");
}

/* ── building one ──────────────────────────────────────────────────────────── */

{
  assert.equal(inviteLink("community.gryt.chat"), "https://gryt.chat/invite?host=community.gryt.chat");
  assert.equal(inviteLink("chat.example.com:5001", "ABC"), "https://gryt.chat/invite?host=chat.example.com%3A5001&code=abc");
  assert.equal(inviteLink("community.gryt.chat", " "), "https://gryt.chat/invite?host=community.gryt.chat", "a blank code is no code");
  assert.deepEqual(parseServerInput(inviteLink("[2001:db8::1]:5001")), { host: "[2001:db8::1]:5001", code: "" });
}

/* ── arriving on one ───────────────────────────────────────────────────────── */

{
  const { store, replaced } = fakeWindow("https://app.gryt.chat/invite?host=community.gryt.chat");
  const pending = capturePendingInviteFromUrl();
  assert.equal(pending?.host, "community.gryt.chat", "a host-only link was dropped");
  assert.equal(pending?.code, "");
  assert.deepEqual(replaced, ["/"], "the link stayed in the address bar");
  assert.equal(store.get("preLoginUrl"), "https://app.gryt.chat/invite?host=community.gryt.chat", "signing in has nowhere to come back to");
  assert.equal(readPendingInvite()?.host, "community.gryt.chat", "the invite didn't survive to be read after sign-in");
  assert.equal(readPendingInvite()?.code, "");
}

{
  fakeWindow("https://app.gryt.chat/invite?host=chat.example.com&code=AbC");
  assert.deepEqual({ ...capturePendingInviteFromUrl(), capturedAt: 0 }, { host: "chat.example.com", code: "abc", capturedAt: 0 });
}

{
  fakeWindow("https://app.gryt.chat/invite/Legacy1");
  assert.deepEqual({ ...capturePendingInviteFromUrl(), capturedAt: 0 }, { host: "app.gryt.chat", code: "legacy1", capturedAt: 0 });
}

for (const url of ["https://app.gryt.chat/invite?code=abc", "https://app.gryt.chat/invite", "https://app.gryt.chat/?host=chat.example.com"]) {
  const { store } = fakeWindow(url);
  assert.equal(capturePendingInviteFromUrl(), null, `${url} made an invite`);
  assert.equal(store.has("pendingInvite"), false);
}

{
  const { store } = fakeWindow("https://app.gryt.chat/");
  assert.equal(writePendingInvite("https://chat.example.com/")?.host, "chat.example.com");
  assert.equal(readPendingInvite()?.code, "", "a desktop deep link with no code was dropped");
  store.set("pendingInvite", JSON.stringify({ host: "", code: "abc" }));
  assert.equal(readPendingInvite(), null, "an invite with no server is not one");
  assert.equal(writePendingInvite("", "abc"), null);
}

/* ── which address a shared link names ─────────────────────────────────────── */

{
  for (const host of ["community.gryt.chat", "chat.example.com:5001", "8.8.8.8", "[2001:db8::1]:5001", "172.32.0.1"]) {
    assert.equal(isPublicHost(host), true, host);
  }
  for (const host of [
    "localhost:5001", "127.0.0.1:5040", "[::1]:5001", "10.0.0.2", "172.16.4.4", "192.168.1.42:5001",
    "169.254.1.1", "100.100.1.1", "[fd00::1]:5001", "fe80::1", "nas", "nas:", "box.local", "gryt.lan",
    "999.1.1.1", "",
  ]) {
    assert.equal(isPublicHost(host), false, host);
  }
}

{
  const hosted = {
    serverPort: 5040,
    advertisedAddresses: ["192.168.1.20"],
    customAdvertisedAddresses: [],
  };

  assert.deepEqual(pickPublicHost("chat.example.com", null), { kind: "ok", host: "chat.example.com" });
  assert.deepEqual(pickPublicHost("127.0.0.1:5040", null), { kind: "none" });
  // An invite code copies the LAN address. This link is for anyone, so it doesn't.
  assert.deepEqual(pickPublicHost("127.0.0.1:5040", hosted), { kind: "none" }, "a detected LAN address was put in a public link");
  assert.deepEqual(pickPublicHost("127.0.0.1:5040", { ...hosted, customAdvertisedAddresses: ["10.0.0.9", " gryt.example.org "] }), { kind: "ok", host: "gryt.example.org:5040" });
  assert.deepEqual(pickPublicHost("127.0.0.1:5040", { ...hosted, customAdvertisedAddresses: ["2001:db8::7"] }), { kind: "ok", host: "[2001:db8::7]:5040" });
  assert.deepEqual(pickPublicHost("192.168.1.20:5040", null), { kind: "none" });

  const servers = [{ id: "a", status: "running", error: null, serverUrl: "http://127.0.0.1:5040", config: { ...hosted, customAdvertisedAddresses: ["203.0.113.4"] } }];
  assert.equal(hostedAdvertisement("localhost:5040", servers)?.serverPort, 5040, "a hosted server at localhost wasn't matched");
  assert.equal(hostedAdvertisement("chat.example.com:5040", servers), null, "a remote server on the same port was taken for ours");
  assert.deepEqual(openServerLink("127.0.0.1:5040", hostedAdvertisement("127.0.0.1:5040", servers)), { kind: "ok", url: "https://gryt.chat/invite?host=203.0.113.4%3A5040" });
  assert.deepEqual(openServerLink("127.0.0.1:5040", null), { kind: "no-public-address", hosted: false });
  assert.deepEqual(openServerLink("127.0.0.1:5040", hosted), { kind: "no-public-address", hosted: true });
  assert.deepEqual(openServerLink("community.gryt.chat", null), { kind: "ok", url: "https://gryt.chat/invite?host=community.gryt.chat" });
}

/* ── the join policy a server announces ────────────────────────────────────── */

{
  for (const policy of ["invite", "request", "open"]) assert.equal(readJoinPolicy(policy), policy);
  for (const junk of [undefined, null, "", "OPEN", "anyone", 1]) assert.equal(readJoinPolicy(junk), null, `${junk} read as a policy`);
}

/* ── the invite dialog ─────────────────────────────────────────────────────── */

const base = {
  linkCode: "",
  typedCode: "",
  lookup: "info",
  info: { identityTiers: ["local", "account"], joinPolicy: "open" },
  isSignedIn: false,
  alreadyMember: false,
  inviteRequired: false,
  accountRequired: false,
  awaitingApproval: false,
};
const view = (patch) => inviteDialogView({ ...base, ...patch });

// A host-only link to an open server joins with nothing typed.
{
  const v = view({});
  assert.equal(v.message, "open");
  assert.deepEqual(v.action, { kind: "join", label: "Join", disabled: false });
  assert.equal(v.showCodeField, false);
  assert.equal(v.code, "");
}

// A code link to an open server still sends the code: that is how a role on the invite lands.
{
  const v = view({ linkCode: "trusted1" });
  assert.equal(v.message, "invited");
  assert.equal(v.code, "trusted1", "an open server's invite went out without its code");
  assert.deepEqual(v.action, { kind: "join", label: "Accept Invite", disabled: false });
}

// An invite-only server says so and waits for a code.
{
  const v = view({ info: { identityTiers: ["local"], joinPolicy: "invite" } });
  assert.equal(v.message, "needs-code");
  assert.equal(v.showCodeField, true);
  assert.equal(v.action.kind === "join" && v.action.disabled, true, "Join was pressable with no code on an invite-only server");
  const typed = view({ info: { identityTiers: ["local"], joinPolicy: "invite" }, typedCode: "abc" });
  assert.equal(typed.code, "abc");
  assert.equal(typed.action.kind === "join" && typed.action.disabled, false);
}

// LAN open lets in whoever is on the network, so the code is asked for but not required.
{
  const v = view({ info: { identityTiers: ["local"], joinPolicy: "invite", lanOpen: true } });
  assert.equal(v.showCodeField, true);
  assert.equal(v.action.kind === "join" && v.action.disabled, false);
}

// Signed out on a server that only takes accounts: sign in, whatever the link carries.
for (const linkCode of ["", "abc"]) {
  const v = view({ linkCode, info: { identityTiers: ["account"], joinPolicy: "open" } });
  assert.equal(v.needsAccount, true);
  assert.deepEqual(v.action, { kind: "sign-in" }, `no Sign in button for ${linkCode ? "a code" : "a host-only"} link`);
  const signedIn = view({ linkCode, isSignedIn: true, info: { identityTiers: ["account"], joinPolicy: "open" } });
  assert.equal(signedIn.action.kind, "join", "signing in didn't bring the join back");
}

// Before the account check answers, nobody is told to sign in.
assert.equal(view({ isSignedIn: undefined, info: { identityTiers: ["account"], joinPolicy: "open" } }).action.kind, "join");

// A server that hid its tiers can still refuse at the door, and then the dialog offers sign-in.
assert.deepEqual(view({ lookup: "private", info: null, accountRequired: true }).action, { kind: "sign-in" });

// A request server asks, with room for a note.
{
  const v = view({ info: { identityTiers: ["local"], joinPolicy: "request" } });
  assert.equal(v.message, "request");
  assert.equal(v.showNote, true);
  assert.deepEqual(v.action, { kind: "join", label: "Ask to join", disabled: false });
  const asked = view({ info: { identityTiers: ["local"], joinPolicy: "request" }, awaitingApproval: true });
  assert.deepEqual(asked.action, { kind: "none" });
  assert.equal(asked.showNote, false);
}

// A refused code on an open server can be dropped, and on an invite-only one it has to be replaced.
{
  const open = view({ linkCode: "expired", inviteRequired: true });
  assert.equal(open.showCodeField, true);
  assert.equal(open.code, "", "the refused code went out again");
  assert.deepEqual(open.action, { kind: "join", label: "Join", disabled: false });
  const closed = view({ linkCode: "expired", inviteRequired: true, info: { identityTiers: ["local"], joinPolicy: "invite" } });
  assert.equal(closed.message, "needs-code");
  assert.equal(closed.action.kind === "join" && closed.action.disabled, true);
}

// A private server gets a Join, and a code field once it asks for one.
{
  assert.deepEqual(view({ lookup: "private", info: null }).action, { kind: "join", label: "Join", disabled: false });
  const asked = view({ lookup: "private", info: null, inviteRequired: true });
  assert.equal(asked.showCodeField, true);
  assert.equal(asked.action.kind === "join" && asked.action.disabled, true);
}

assert.deepEqual(view({ alreadyMember: true }).action, { kind: "go-to-server" });
assert.equal(view({ lookup: "loading", info: null }).action.kind === "join" && view({ lookup: "loading", info: null }).action.disabled, true);

/* ── the desktop's gryt://invite ───────────────────────────────────────────── */

{
  const main = read("electron/main.ts");
  const at = main.indexOf("function handleDeepLink(");
  assert.notEqual(at, -1, "electron/main.ts no longer has handleDeepLink, so this check reads nothing");
  const body = main.slice(at, main.indexOf("\n}\n", at));
  assert.ok(/deep-link-invite/.test(body), "handleDeepLink stopped forwarding invites");
  assert.ok(!/host && code/.test(body), "a gryt://invite with no code is dropped again");
  assert.ok(/if \(host\) \{\s*mainWindow\.webContents\.send\("deep-link-invite", \{ host, code \}\)/.test(body), "handleDeepLink sends invites some other way, so this check reads the wrong thing");
}

console.log("invite links: ok");
