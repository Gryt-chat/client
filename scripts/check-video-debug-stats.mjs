/* eslint-env node */

// What the video debug overlay reads out of getStats. Chromium names an outbound track only on
// its media-source entry, and rates come from the stats' own timestamps (GRYT-1319).

import assert from "node:assert/strict";

import { readVideoStats } from "../src/components/videoDebugStats.ts";

const tracks = { camera: "camera-track", screen: "screen-track" };

/** Averages divide floats, so compare them to a hair. */
function near(actual, expected) {
  assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
}

/** A report shaped like Chromium's: outbound-rtp carries mediaSourceId and no trackIdentifier. */
function report(t, { screenBytes, cameraBytes, receivedBytes, decoded, dropped, received, lost, rtt = 0.062, rttMeasurements = 59 }) {
  return [
    // Nominated too, and listed first. The transport's selected pair is the one in use.
    { id: "CPstale", type: "candidate-pair", timestamp: t, state: "succeeded", nominated: true, currentRoundTripTime: 0.5, localCandidateId: "L1", remoteCandidateId: "R1" },
    { id: "T01", type: "transport", timestamp: t, selectedCandidatePairId: "CP1" },
    { id: "CP1", type: "candidate-pair", timestamp: t, state: "succeeded", nominated: true, currentRoundTripTime: 0.012, availableOutgoingBitrate: 2_500_000, localCandidateId: "L1", remoteCandidateId: "R1" },
    { id: "L1", type: "local-candidate", timestamp: t, candidateType: "host", networkType: "wifi", protocol: "udp" },
    { id: "R1", type: "remote-candidate", timestamp: t, candidateType: "host", protocol: "udp" },
    { id: "COT01", type: "codec", timestamp: t, mimeType: "video/H264", sdpFmtpLine: "packetization-mode=1;profile-level-id=42001f" },
    { id: "SV1", type: "media-source", kind: "video", timestamp: t, trackIdentifier: "camera-track" },
    { id: "SV2", type: "media-source", kind: "video", timestamp: t, trackIdentifier: "screen-track" },
    {
      id: "OT01V1", type: "outbound-rtp", kind: "video", timestamp: t, ssrc: 1, mediaSourceId: "SV2", codecId: "COT01", remoteId: "RIV1",
      bytesSent: screenBytes, packetsSent: 100, totalPacketSendDelay: 0.5, targetBitrate: 3_000_000, framesEncoded: 50,
      keyFramesEncoded: 2, qpSum: 500, totalEncodeTime: 0.1, framesPerSecond: 30, frameWidth: 1280, frameHeight: 720,
      qualityLimitationReason: "none", qualityLimitationDurations: { none: 5, cpu: 0, bandwidth: 1.5, other: 0 },
    },
    { id: "OT01V2", type: "outbound-rtp", kind: "video", timestamp: t, ssrc: 2, mediaSourceId: "SV1", codecId: "COT01", bytesSent: cameraBytes, framesPerSecond: 20 },
    { id: "RIV1", type: "remote-inbound-rtp", kind: "video", timestamp: t, jitter: 0.002, fractionLost: 0.01, packetsLost: 3, roundTripTime: rtt, roundTripTimeMeasurements: rttMeasurements },
    {
      id: "IT01V3", type: "inbound-rtp", kind: "video", timestamp: t, ssrc: 3, trackIdentifier: "remote-track", codecId: "COT01",
      bytesReceived: receivedBytes, framesDecoded: decoded, framesDropped: dropped, packetsReceived: received, packetsLost: lost,
      totalDecodeTime: decoded * 0.002, jitterBufferDelay: decoded * 0.01, jitterBufferEmittedCount: decoded,
    },
  ];
}

const counters = { screenBytes: 100_000, cameraBytes: 50_000, receivedBytes: 80_000, decoded: 100, dropped: 0, received: 300, lost: 0 };

/* ── Outbound rows are labelled through the media source ─────────────── */

const first = readVideoStats(report(10_000, counters), new Map(), tracks);
assert.deepEqual(first.outbound.map((row) => [row.id, row.label]), [["OT01V1", "screen"], ["OT01V2", "camera"]]);

const screen = first.outbound[0];
assert.equal(screen.codec, "video/H264");
assert.equal(screen.codecFmtp, "packetization-mode=1;profile-level-id=42001f");
assert.equal(screen.targetBitrateKbps, 3000);
near(screen.averagePacketSendDelayMs, 5);
near(screen.averageQp, 10);
near(screen.averageEncodeTimeMs, 2);
near(screen.remoteJitterMs, 2);
near(screen.remoteLossPct, 1);
assert.equal(screen.remotePacketsLost, 3);
assert.equal(screen.bandwidthLimitedSeconds, 1.5);

// Chrome counts the receiver reports that carried a round-trip time, and has no reportsReceived.
near(screen.remoteRttMs, 62);
assert.equal(screen.remoteRttMeasurements, 59);
assert.equal(first.outbound[1].remoteRttMeasurements, null, "a sender with no remote-inbound entry has no count");

// Reports with no LSR in them give Chrome nothing to time, so there is no RTT and the count sits at 0.
const noLsr = readVideoStats(report(10_000, { ...counters, rtt: null, rttMeasurements: 0 }), new Map(), tracks).outbound[0];
assert.equal(noLsr.remoteRttMs, null);
assert.equal(noLsr.remoteRttMeasurements, 0);

// A first reading has nothing to take a rate against, and still shows the rows.
assert.equal(screen.bitrateKbps, null);
assert.equal(first.inbound[0].recentDecodedFps, null);

// A track the engine didn't send on is plain video.
const unknown = readVideoStats(report(10_000, counters), new Map(), { camera: null, screen: null });
assert.deepEqual(unknown.outbound.map((row) => row.label), ["video", "video"]);

/* ── Rates come from the stats' timestamps ───────────────────────────── */

// One second on the stats' clock, whenever the poll happened to run.
const second = readVideoStats(
  report(11_000, { ...counters, screenBytes: 225_000, cameraBytes: 100_000, receivedBytes: 205_000, decoded: 120, dropped: 1, received: 358, lost: 2 }),
  first.samples,
  tracks,
);
assert.equal(second.outbound[0].bitrateKbps, 1000);
assert.equal(second.outbound[1].bitrateKbps, 400);
const inbound = second.inbound[0];
assert.equal(inbound.bitrateKbps, 1000);
assert.equal(inbound.recentDecodedFps, 20);
assert.equal(inbound.recentDroppedFps, 1);
assert.equal(inbound.recentPacketsReceivedPerSecond, 58);
near(inbound.recentLossPct, (2 / 60) * 100);
near(inbound.averageDecodeTimeMs, 2);

// Two seconds between readings is half the rate per second of the same change, not the same rate.
const later = readVideoStats(report(13_000, { ...counters, screenBytes: 350_000 }), second.samples, tracks);
assert.equal(later.outbound[0].bitrateKbps, 500);

// The same report twice has no elapsed time, so no rate rather than Infinity.
const same = readVideoStats(second.samples.values(), second.samples, tracks);
assert.equal(same.inbound[0].recentDecodedFps, null);
assert.equal(same.outbound[0].bitrateKbps, null);

// A counter going backwards is a new stream under an old id.
const restarted = readVideoStats(report(12_000, counters), second.samples, tracks);
assert.equal(restarted.inbound[0].bitrateKbps, null);
assert.equal(restarted.inbound[0].recentDecodedFps, null);

/* ── Stopped senders drop out, the connection uses the selected pair ─── */

// The camera stopped: its bytes stand still and it reports no frame rate.
const stopped = report(12_000, { ...counters, screenBytes: 350_000, cameraBytes: 100_000 });
delete stopped.find((stat) => stat.id === "OT01V2").framesPerSecond;
assert.deepEqual(readVideoStats(stopped, second.samples, tracks).outbound.map((row) => row.label), ["screen"]);

near(first.connection.rttMs, 12);
assert.equal(first.connection.availableOutKbps, 2500);
assert.equal(first.connection.localCandidateType, "host");
assert.equal(first.connection.protocol, "udp");

console.log("video debug stats ok");
