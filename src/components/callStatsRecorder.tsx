import { useSFU, useVoiceLatency } from "@gryt/voice";
import { useEffect, useRef } from "react";

import { useSockets } from "@/socket";
import { useVoicePresence } from "@/webRTC";

import { endCallTimeline, recordCallSample, startCallTimeline } from "../lib/reports/callTimeline";

/** Everyone's made-up frames added up; null off the own transport. */
const madeUp = (byUser: ReadonlyMap<string, number> | undefined) =>
  byUser ? [...byUser.values()].reduce((a, b) => a + b, 0) : null;

/**
 * Records the call's numbers once a second while you're in one (GRYT-1663). Mounted at the
 * root beside the tray, so it runs whether or not the debug overlay or any panel is open.
 */
export function CallStatsRecorder() {
  const voice = useVoicePresence();
  const inCall = voice.inCall;
  const { latency } = useVoiceLatency(inCall);
  const { getTransportLatency } = useSFU();
  const transportRef = useRef(getTransportLatency);
  transportRef.current = getTransportLatency;
  const { sockets } = useSockets();
  const latest = useRef(latency);
  const socketRtt = useRef<number | null>(null);
  latest.current = latency;

  // The voice server's socket, pinged the way the debug overlay does it.
  const socket = voice.host ? sockets[voice.host] : undefined;
  useEffect(() => {
    if (!inCall || !socket) return;
    socketRtt.current = null;
    const onPong = (payload: { t0?: number }) => {
      if (typeof payload?.t0 === "number") socketRtt.current = Math.max(0, Date.now() - payload.t0);
    };
    socket.on("diagnostics:pong", onPong);
    const ping = setInterval(() => socket.emit("diagnostics:ping", { t0: Date.now() }), 1000);
    return () => {
      clearInterval(ping);
      socket.off("diagnostics:pong", onPong);
    };
  }, [inCall, socket]);

  useEffect(() => {
    if (!inCall) return;
    startCallTimeline();
    const tick = setInterval(() => {
      const l = latest.current;
      recordCallSample({
        socketRttMs: socketRtt.current,
        rttMs: l.networkRttMs,
        jitterMs: l.jitterMs,
        jitterBufferMs: l.jitterBufferMs,
        packetsLost: l.packetsLost,
        bitrateKbps: l.bitrateKbps,
        estimatedRoundTripMs: l.estimatedRoundTripMs,
        transportBufferedMs: l.transportBufferedMs,
        transportRttMs: l.transportRttMs,
        transportConcealed: madeUp(transportRef.current?.()?.concealedByUser),
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
      });
    }, 1000);
    return () => {
      clearInterval(tick);
      endCallTimeline();
    };
  }, [inCall]);

  return null;
}
