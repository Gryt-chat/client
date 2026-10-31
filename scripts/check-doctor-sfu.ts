// The Doctor tests the address the voice engine would use, and spots an SFU_PUBLIC_HOST
// that points at the Gryt server. Al's server did that on 2026-10-31. GRYT-1986.

import assert from "node:assert/strict";

const { isGrytServerAddress, sfuWsUrl } = await import("../src/packages/socket/src/lib/serverDoctor.ts");

assert.equal(sfuWsUrl("wss://sfu.example.com"), "wss://sfu.example.com/", "a public wss address lost its TLS");
assert.equal(sfuWsUrl("wss://192.168.1.5:5005"), "ws://192.168.1.5:5005/", "the engine drops TLS for a private IP");
assert.equal(sfuWsUrl("ws://sfu.example.com:5005"), "ws://sfu.example.com:5005/");

assert(isGrytServerAddress("wss://chat.example.com", "chat.example.com"), "same hostname, same port");
assert(isGrytServerAddress("wss://other.example.com", "chat.example.com", "signaling-server"), "it says it is the server");
assert(!isGrytServerAddress("wss://sfu.example.com", "chat.example.com", "sfu"), "a separate SFU was flagged");
assert(!isGrytServerAddress("ws://203.0.113.10:5005", "203.0.113.10:5000"), "same machine on another port is fine");

console.log("doctor-sfu: ok");
