/** One entry of a getStats report. Browsers leave out what they don't track, so every field is optional. */
export type Stat = { id: string; type: string; timestamp: number } & Record<string, unknown>;

export type VideoLabel = "camera" | "screen" | "video";

/** The tracks on the engine's camera and screen senders, to tell outbound video apart. */
export interface SenderTracks {
  camera: string | null;
  screen: string | null;
}

export interface ConnectionDiagnostics {
  rttMs: number | null;
  availableOutKbps: number | null;
  availableInKbps: number | null;
  bytesDiscardedOnSend: number | null;
  packetsDiscardedOnSend: number | null;
  localCandidateType: string | null;
  localNetworkType: string | null;
  remoteCandidateType: string | null;
  protocol: string | null;
}

export interface OutboundDiagnostics {
  id: string;
  label: VideoLabel;
  codec: string | null;
  codecFmtp: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  bitrateKbps: number | null;
  targetBitrateKbps: number | null;
  packetsSent: number | null;
  retransmittedPacketsSent: number | null;
  retransmittedBytesSent: number | null;
  averagePacketSendDelayMs: number | null;
  framesEncoded: number | null;
  keyFramesEncoded: number | null;
  totalEncodeTimeMs: number | null;
  averageEncodeTimeMs: number | null;
  averageQp: number | null;
  pliCount: number | null;
  nackCount: number | null;
  remoteRttMs: number | null;
  remoteJitterMs: number | null;
  remotePacketsLost: number | null;
  remoteLossPct: number | null;
  /** Receiver reports that carried a round-trip time. Chrome never fills in reportsReceived. */
  remoteRttMeasurements: number | null;
  qualityLimitationReason: string | null;
  bandwidthLimitedSeconds: number | null;
  cpuLimitedSeconds: number | null;
  otherLimitedSeconds: number | null;
  resolutionChanges: number | null;
  scalabilityMode: string | null;
  encoderImplementation: string | null;
}

export interface InboundDiagnostics {
  id: string;
  trackId: string;
  codec: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  framesPerSecond: number | null;
  bitrateKbps: number | null;
  jitterMs: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  packetsDiscarded: number | null;
  framesReceived: number | null;
  framesDecoded: number | null;
  framesDropped: number | null;
  averageDecodeTimeMs: number | null;
  averageProcessingDelayMs: number | null;
  averageJitterBufferDelayMs: number | null;
  framesAssembledFromMultiplePackets: number | null;
  averageAssemblyTimeMs: number | null;
  freezeCount: number | null;
  totalFreezesDurationMs: number | null;
  decoderImplementation: string | null;
  pliCount: number | null;
  firCount: number | null;
  nackCount: number | null;
  recentDecodedFps: number | null;
  recentDroppedFps: number | null;
  recentDropPct: number | null;
  recentPacketsReceivedPerSecond: number | null;
  recentPacketsLostPerSecond: number | null;
  recentLossPct: number | null;
  recentNackCount: number | null;
  recentPliCount: number | null;
}

export interface VideoStatsReading {
  connection: ConnectionDiagnostics;
  outbound: OutboundDiagnostics[];
  inbound: InboundDiagnostics[];
  /** The RTP entries read this time, for the next reading to take its rates against. */
  samples: Map<string, Stat>;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function linked(byId: Map<string, Stat>, id: unknown): Stat | undefined {
  return typeof id === "string" ? byId.get(id) : undefined;
}

/** How far a counter moved. Null when it went backwards, which is a new stream under the same id. */
function delta(current: number | null, before: number | null): number | null {
  if (current == null || before == null || current < before) return null;
  return current - before;
}

function perSecond(change: number | null, seconds: number | null): number | null {
  if (change == null || seconds == null) return null;
  return change / seconds;
}

function percent(part: number | null, whole: number | null): number | null {
  if (part == null || whole == null || whole <= 0) return null;
  return (part / whole) * 100;
}

function average(total: number | null, count: number | null, scale = 1): number | null {
  if (total == null || count == null || count <= 0) return null;
  return (total * scale) / count;
}

function scaled(value: number | null, by: number): number | null {
  return value == null ? null : value * by;
}

function kbps(bitsPerSecond: number | null): number | null {
  return bitsPerSecond == null ? null : bitsPerSecond / 1000;
}

/** Seconds between two readings of one entry, on the stats' own clock rather than whenever the poll ran. */
function elapsed(stat: Stat, before: Stat | undefined): number | null {
  const ms = before ? stat.timestamp - before.timestamp : 0;
  return ms > 0 ? ms / 1000 : null;
}

export function labelForTrack(trackId: string | null, tracks: SenderTracks): VideoLabel {
  if (trackId && trackId === tracks.camera) return "camera";
  if (trackId && trackId === tracks.screen) return "screen";
  return "video";
}

/** A first reading has no rate yet. After that, an entry whose track stopped lingers at zero. */
function flowing(row: { bitrateKbps: number | null; framesPerSecond: number | null }): boolean {
  return row.bitrateKbps == null || row.bitrateKbps > 0 || (row.framesPerSecond ?? 0) > 0;
}

function selectedPair(byId: Map<string, Stat>): Stat | undefined {
  for (const stat of byId.values()) {
    const pair = stat.type === "transport" ? linked(byId, stat.selectedCandidatePairId) : undefined;
    if (pair) return pair;
  }
  for (const stat of byId.values()) {
    if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.nominated) return stat;
  }
  return undefined;
}

function readConnection(byId: Map<string, Stat>): ConnectionDiagnostics {
  const pair = selectedPair(byId);
  const local = pair && linked(byId, pair.localCandidateId);
  const remote = pair && linked(byId, pair.remoteCandidateId);
  return {
    rttMs: scaled(num(pair?.currentRoundTripTime), 1000),
    availableOutKbps: kbps(num(pair?.availableOutgoingBitrate)),
    availableInKbps: kbps(num(pair?.availableIncomingBitrate)),
    bytesDiscardedOnSend: num(pair?.bytesDiscardedOnSend),
    packetsDiscardedOnSend: num(pair?.packetsDiscardedOnSend),
    localCandidateType: text(local?.candidateType),
    localNetworkType: text(local?.networkType),
    remoteCandidateType: text(remote?.candidateType),
    protocol: text(remote?.protocol) ?? text(local?.protocol),
  };
}

function readOutbound(stat: Stat, before: Stat | undefined, byId: Map<string, Stat>, tracks: SenderTracks): OutboundDiagnostics {
  // Chromium names the track on the media-source entry. outbound-rtp has no trackIdentifier.
  const trackId = text(linked(byId, stat.mediaSourceId)?.trackIdentifier) ?? text(stat.trackIdentifier);
  const codec = linked(byId, stat.codecId);
  const remote = linked(byId, stat.remoteId);
  const durations = (stat.qualityLimitationDurations ?? {}) as Record<string, unknown>;
  const seconds = elapsed(stat, before);
  const framesEncoded = num(stat.framesEncoded);
  const totalEncodeTime = num(stat.totalEncodeTime);

  return {
    id: stat.id,
    label: labelForTrack(trackId, tracks),
    codec: text(codec?.mimeType),
    codecFmtp: text(codec?.sdpFmtpLine),
    frameWidth: num(stat.frameWidth),
    frameHeight: num(stat.frameHeight),
    framesPerSecond: num(stat.framesPerSecond),
    bitrateKbps: kbps(scaled(perSecond(delta(num(stat.bytesSent), num(before?.bytesSent)), seconds), 8)),
    targetBitrateKbps: kbps(num(stat.targetBitrate)),
    packetsSent: num(stat.packetsSent),
    retransmittedPacketsSent: num(stat.retransmittedPacketsSent),
    retransmittedBytesSent: num(stat.retransmittedBytesSent),
    averagePacketSendDelayMs: average(num(stat.totalPacketSendDelay), num(stat.packetsSent), 1000),
    framesEncoded,
    keyFramesEncoded: num(stat.keyFramesEncoded),
    totalEncodeTimeMs: scaled(totalEncodeTime, 1000),
    averageEncodeTimeMs: average(totalEncodeTime, framesEncoded, 1000),
    averageQp: average(num(stat.qpSum), framesEncoded),
    pliCount: num(stat.pliCount),
    nackCount: num(stat.nackCount),
    remoteRttMs: scaled(num(remote?.roundTripTime), 1000),
    remoteJitterMs: scaled(num(remote?.jitter), 1000),
    remotePacketsLost: num(remote?.packetsLost),
    remoteLossPct: scaled(num(remote?.fractionLost), 100),
    remoteRttMeasurements: num(remote?.roundTripTimeMeasurements),
    qualityLimitationReason: text(stat.qualityLimitationReason),
    bandwidthLimitedSeconds: num(durations.bandwidth),
    cpuLimitedSeconds: num(durations.cpu),
    otherLimitedSeconds: num(durations.other),
    resolutionChanges: num(stat.qualityLimitationResolutionChanges),
    scalabilityMode: text(stat.scalabilityMode),
    encoderImplementation: text(stat.encoderImplementation),
  };
}

function readInbound(stat: Stat, before: Stat | undefined, byId: Map<string, Stat>): InboundDiagnostics {
  const seconds = elapsed(stat, before);
  const framesDecoded = num(stat.framesDecoded);
  const framesAssembled = num(stat.framesAssembledFromMultiplePackets);
  const decoded = delta(framesDecoded, num(before?.framesDecoded));
  const dropped = delta(num(stat.framesDropped), num(before?.framesDropped));
  const received = delta(num(stat.packetsReceived), num(before?.packetsReceived));
  const lost = delta(num(stat.packetsLost), num(before?.packetsLost));
  const ssrc = num(stat.ssrc);

  return {
    id: stat.id,
    trackId: text(stat.trackIdentifier) ?? (ssrc != null ? String(ssrc) : stat.id),
    codec: text(linked(byId, stat.codecId)?.mimeType),
    frameWidth: num(stat.frameWidth),
    frameHeight: num(stat.frameHeight),
    framesPerSecond: num(stat.framesPerSecond),
    bitrateKbps: kbps(scaled(perSecond(delta(num(stat.bytesReceived), num(before?.bytesReceived)), seconds), 8)),
    jitterMs: scaled(num(stat.jitter), 1000),
    packetsReceived: num(stat.packetsReceived),
    packetsLost: num(stat.packetsLost),
    packetsDiscarded: num(stat.packetsDiscarded),
    framesReceived: num(stat.framesReceived),
    framesDecoded,
    framesDropped: num(stat.framesDropped),
    averageDecodeTimeMs: average(num(stat.totalDecodeTime), framesDecoded, 1000),
    averageProcessingDelayMs: average(num(stat.totalProcessingDelay), framesDecoded, 1000),
    averageJitterBufferDelayMs: average(num(stat.jitterBufferDelay), num(stat.jitterBufferEmittedCount), 1000),
    framesAssembledFromMultiplePackets: framesAssembled,
    averageAssemblyTimeMs: average(num(stat.totalAssemblyTime), framesAssembled, 1000),
    freezeCount: num(stat.freezeCount),
    totalFreezesDurationMs: scaled(num(stat.totalFreezesDuration), 1000),
    decoderImplementation: text(stat.decoderImplementation),
    pliCount: num(stat.pliCount),
    firCount: num(stat.firCount),
    nackCount: num(stat.nackCount),
    recentDecodedFps: perSecond(decoded, seconds),
    recentDroppedFps: perSecond(dropped, seconds),
    recentDropPct: percent(dropped, decoded != null && dropped != null ? decoded + dropped : null),
    recentPacketsReceivedPerSecond: perSecond(received, seconds),
    recentPacketsLostPerSecond: perSecond(lost, seconds),
    recentLossPct: percent(lost, received != null && lost != null ? received + lost : null),
    recentNackCount: delta(num(stat.nackCount), num(before?.nackCount)),
    recentPliCount: delta(num(stat.pliCount), num(before?.pliCount)),
  };
}

/** Everything the video overlay shows, from one getStats report and the RTP entries of the one before. */
export function readVideoStats(
  report: Iterable<Stat>,
  previous: ReadonlyMap<string, Stat>,
  tracks: SenderTracks,
): VideoStatsReading {
  const byId = new Map<string, Stat>();
  for (const stat of report) byId.set(stat.id, stat);

  const samples = new Map<string, Stat>();
  const outbound: OutboundDiagnostics[] = [];
  const inbound: InboundDiagnostics[] = [];

  for (const stat of byId.values()) {
    if (stat.kind !== "video") continue;
    if (stat.type === "outbound-rtp") {
      samples.set(stat.id, stat);
      const row = readOutbound(stat, previous.get(stat.id), byId, tracks);
      if (flowing(row)) outbound.push(row);
    } else if (stat.type === "inbound-rtp") {
      samples.set(stat.id, stat);
      const row = readInbound(stat, previous.get(stat.id), byId);
      if (flowing(row)) inbound.push(row);
    }
  }

  return { connection: readConnection(byId), outbound, inbound, samples };
}
