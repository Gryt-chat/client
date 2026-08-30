/* eslint-env node */

/**
 * A file that goes up encrypted and comes back readable (GRYT-761).
 *
 * The round trip is driven for real, through `@gryt/crypto` and the actual
 * curve library, because the failure it guards is silent in both directions: a
 * file that goes up in the clear from a conversation the composer says is
 * encrypted, and a file that comes back as an unnamed octet-stream because the
 * metadata from inside the envelope was never applied.
 *
 * The parts that need a browser — `fetch`, `Blob`, `URL.createObjectURL` — are
 * stubbed. What is checked here is what happens to the bytes and to the
 * metadata, which is where the mistakes live.
 */

import assert from "node:assert/strict";

import {
  deriveDmKeyPair,
  openAttachment,
  openMessage,
  sealAttachment,
  sealMessage,
  asIdentityScope,
} from "@gryt/crypto";

import { sealedAttachmentMeta, fetchSealedAttachment } from "../src/packages/socket/src/utils/sealedAttachments.ts";

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
  // `name` and `mime` are optional in the envelope, and a picker can report
  // neither. An `undefined` mime reaching the renderer would make it fall
  // through every branch and draw nothing at all.
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
  "sealed attachments: a file goes up encrypted, comes back with the sender's name and type, and draws as itself",
);
