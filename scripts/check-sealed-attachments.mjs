/* eslint-env node */

/**
 * A file that goes up encrypted and comes back readable. Driven for real through
 * `@gryt/crypto`, because the failure is silent in both directions (GRYT-761).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  deriveDmKeyPair,
  openAttachment,
  openMessage,
  sealAttachment,
  sealMessage,
  asIdentityScope,
} from "@gryt/crypto";

import {
  fetchSealedAttachment,
  openSealedAttachment,
  opensOnPlay,
  sealedAttachmentMeta,
} from "../src/packages/socket/src/utils/sealedAttachments.ts";

const SCOPE = asIdentityScope("srv:attachments");
const CONVERSATION = "dm_g0123456789abcdef0123456789abcdef";
const seed = (n) => Uint8Array.from({ length: 32 }, (_, i) => (i * n + n) % 251);

const alice = { id: "user_alice", keys: deriveDmKeyPair(seed(3), SCOPE) };
const bob = { id: "user_bob", keys: deriveDmKeyPair(seed(7), SCOPE) };
const pair = [alice, bob].map((p) => ({ memberId: p.id, publicKey: p.keys.publicKey }));

/** A PNG-ish body with bytes above 0x7f, which is where a lazy encoding breaks. */
const FILE = Uint8Array.from({ length: 3000 }, (_, i) => (i * 37) % 256);

/* ── the whole way round: seal, "upload", "download", open, draw ─────────── */

{
  const { ciphertext, meta } = sealAttachment({
    bytes: FILE,
    conversationId: CONVERSATION,
    name: "holiday.png",
    mime: "image/png",
    width: 800,
    height: 600,
  });

  // What the server would hold. It never sees any of the above.
  const stored = ciphertext;

  const sealed = await sealMessage({
    plaintext: "have a look",
    conversationId: CONVERSATION,
    senderKeys: alice.keys,
    recipients: pair,
    attachments: { server_file_id: meta },
  });

  // Nothing about the file is legible in what goes on the wire.
  const wire = JSON.stringify(sealed);
  for (const secret of [meta.key, "holiday.png"]) {
    assert.ok(!wire.includes(secret), `"${secret}" is in the envelope in the clear`);
  }

  const opened = await openMessage({
    sealed,
    conversationId: CONVERSATION,
    memberId: bob.id,
    recipientKeys: bob.keys,
  });

  const key = opened.attachments.server_file_id;
  assert.ok(key, "the recipient got no key for the file");

  const plain = openAttachment({ ciphertext: stored, conversationId: CONVERSATION, meta: key });
  assert.deepEqual(Array.from(plain), Array.from(FILE), "the bytes did not survive");

  // And the row draws it as the picture it is, not as the octet-stream the
  // server thinks it is.
  const drawn = sealedAttachmentMeta("server_file_id", key, "blob:fake");
  assert.equal(drawn.mime, "image/png", "an encrypted image would draw as a download");
  assert.equal(drawn.original_name, "holiday.png");
  assert.equal(drawn.width, 800);
  assert.equal(drawn.height, 600);
  assert.equal(drawn.size, FILE.length, "the size shown is the file's, not the ciphertext's");
  assert.equal(drawn.local_url, "blob:fake");
  assert.equal(drawn.has_thumbnail, false, "there is no thumbnail and claiming one 404s");
}

/* ── a file with nothing said about it still draws ───────────────────────── */

{
  // `name` and `mime` are optional in the envelope. An `undefined` mime reaching
  // the renderer falls through every branch and draws nothing.
  const { meta } = sealAttachment({ bytes: FILE, conversationId: CONVERSATION });
  const drawn = sealedAttachmentMeta("f", meta, "blob:fake");

  assert.equal(drawn.mime, "application/octet-stream");
  assert.equal(drawn.original_name, null);
  assert.equal(drawn.width, null);
  assert.equal(drawn.height, null);
}

/* ── the fetch path decrypts and labels the blob ─────────────────────────── */

{
  const { ciphertext, meta } = sealAttachment({
    bytes: FILE,
    conversationId: CONVERSATION,
    mime: "image/png",
  });

  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, arrayBuffer: async () => ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) };
  };

  const blob = await fetchSealedAttachment({
    url: "https://gryt.test/api/uploads/files/abc",
    key: meta,
    openFile: (bytes, m) => openAttachment({ ciphertext: bytes, conversationId: CONVERSATION, meta: m }),
  });

  assert.equal(blob.type, "image/png",
    "the blob carries the server's type, so an <img> would refuse it");
  assert.deepEqual(Array.from(new Uint8Array(await blob.arrayBuffer())), Array.from(FILE));

  // No credentials on a request that does not need them. The bytes are useless
  // without the key, and the URL ends up inside a blob the page holds.
  assert.equal(seen[0].init.credentials, "omit");
  assert.equal(seen[0].init.headers, undefined, "a bearer token went on the download");
}

/* ── a video waits for play; everything else opens with the message ──────── */

{
  const video = sealAttachment({ bytes: FILE, conversationId: CONVERSATION, name: "clip.webm", mime: "video/webm" });
  const image = sealAttachment({ bytes: FILE, conversationId: CONVERSATION, mime: "image/png" });
  const unnamed = sealAttachment({ bytes: FILE, conversationId: CONVERSATION });
  const stored = { video: video.ciphertext, image: image.ciphertext, unnamed: unnamed.ciphertext };

  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(url);
    const bytes = stored[new URL(url).pathname.split("/").pop()];
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  };
  let token = "A";
  const kept = [];
  const openOne = (fileId, meta) =>
    openSealedAttachment({
      fileId,
      key: meta,
      fileUrl: () => `https://gryt.test/api/uploads/files/${fileId}?t=${token}`,
      openFile: (bytes, m) => openAttachment({ ciphertext: bytes, conversationId: CONVERSATION, meta: m }),
      keepUrl: (url) => kept.push(url),
    });

  assert.equal(opensOnPlay({ mime: "video/mp4" }), true);
  for (const mime of ["image/png", "audio/ogg", "application/pdf", undefined]) {
    assert.equal(opensOnPlay({ mime }), false, `${mime} would wait for a play button it does not have`);
  }

  const drawn = await openOne("video", video.meta);
  assert.deepEqual(seen, [], "an encrypted video was downloaded when its message opened, before anybody pressed play");
  assert.equal(drawn.local_url, undefined);
  assert.equal(kept.length, 0);
  assert.equal(drawn.mime, "video/webm", "a waiting video has to draw as a video, or it gets no play button");
  assert.equal(drawn.original_name, "clip.webm");
  assert.equal(typeof drawn.open_sealed, "function");

  token = "B";
  const blob = await drawn.open_sealed();
  assert.deepEqual(seen, ["https://gryt.test/api/uploads/files/video?t=B"],
    "pressing play did not fetch once, with the token current at the press");
  assert.equal(blob.type, "video/webm");
  assert.deepEqual(Array.from(new Uint8Array(await blob.arrayBuffer())), Array.from(FILE));

  seen.length = 0;
  for (const [fileId, meta] of [["image", image.meta], ["unnamed", unnamed.meta]]) {
    const opened = await openOne(fileId, meta);
    assert.equal(opened.open_sealed, undefined, `${fileId} was left for a press that nothing draws`);
    assert.ok(opened.local_url?.startsWith("blob:"), `${fileId} did not open with its message`);
    assert.ok(kept.includes(opened.local_url), `${fileId}'s blob URL is not handed back to be revoked`);
  }
  assert.equal(seen.length, 2);
  for (const url of kept) URL.revokeObjectURL(url);

  // The hook has to use the function above, or all of this tests something the app never calls.
  const useChat = readFileSync(new URL("../src/packages/socket/src/hooks/useChat.ts", import.meta.url), "utf8");
  assert.match(useChat, /openSealedAttachment\(\{/, "useChat no longer opens attachments through openSealedAttachment");
  assert.doesNotMatch(useChat, /fetchSealedAttachment/, "useChat fetches sealed files itself again, videos included");
}

/* ── a refused download is an error, not an empty file ───────────────────── */

{
  globalThis.fetch = async () => ({ ok: false, status: 404 });

  await assert.rejects(
    () =>
      fetchSealedAttachment({
        url: "https://gryt.test/api/uploads/files/gone",
        key: { id: "x", key: "y", iv: "z" },
        openFile: () => new Uint8Array(),
      }),
    /404/,
    "a missing attachment resolved to something rather than throwing",
  );
}

console.log(
  "sealed attachments: a file goes up encrypted, comes back with the sender's name and type, and draws as itself; a video waits for play",
);
