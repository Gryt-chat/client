import { useCallback, useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useCamera } from "@/audio";
import { CENTRED, detectFraming, type Framing } from "@/audio/src/lib/faceFraming";
import { useSettings } from "@/settings";

import { useSockets } from "./useSockets";

/**
 * Republished this often, unchanged.
 *
 * Framing only moves when someone asks it to, so without this anyone who joins
 * after the last re-centre would see a centred crop until the sender happened
 * to press the button again — which might be never. Two numbers on this
 * interval is nothing, and it keeps the server from having to store anything.
 */
const REPUBLISH_MS = 15000;

type FramingMap = Record<string, Framing>;

const INITIAL = {
  framingByClient: {} as FramingMap,
  localFraming: CENTRED,
  recentre: async () => {},
  detecting: false,
};

function useVideoFramingHook() {
  const { sockets } = useSockets();
  const { faceFramingEnabled } = useSettings();
  const { cameraStream, cameraEnabled } = useCamera();

  const [framingByClient, setFramingByClient] = useState<FramingMap>({});
  const [localFraming, setLocalFraming] = useState<Framing>(CENTRED);
  const [detecting, setDetecting] = useState(false);

  const socketsRef = useRef(sockets);
  socketsRef.current = sockets;
  const framingRef = useRef<Framing>(CENTRED);
  framingRef.current = localFraming;

  const publish = useCallback((framing: Framing) => {
    const all = socketsRef.current;
    for (const host of Object.keys(all)) {
      all[host]?.emit("voice:framing:set", framing);
    }
  }, []);

  /** Look once, and tell everyone what was found. */
  const recentre = useCallback(async () => {
    if (!cameraStream) return;
    setDetecting(true);
    try {
      const found = await detectFraming(cameraStream);
      // No face found leaves the framing where it was, rather than snapping
      // back to centre because someone reached for their coffee.
      if (found) {
        setLocalFraming(found);
        publish(found);
      }
    } finally {
      setDetecting(false);
    }
  }, [cameraStream, publish]);

  // Everyone else's framing, straight off the socket.
  useEffect(() => {
    const offs: Array<() => void> = [];

    for (const host of Object.keys(sockets)) {
      const socket = sockets[host];
      if (!socket) continue;

      const onFraming = (p: { clientId: string; x: number; y: number }) => {
        setFramingByClient((prev) => ({
          ...prev,
          [p.clientId]: { x: p.x, y: p.y },
        }));
      };

      socket.on("voice:framing", onFraming);
      offs.push(() => socket.off("voice:framing", onFraming));
    }

    return () => offs.forEach((off) => off());
  }, [sockets]);

  // The one automatic run: when the camera comes on. After that it is manual,
  // because your framing does not change unless you move.
  useEffect(() => {
    if (!faceFramingEnabled || !cameraEnabled || !cameraStream) return;
    void recentre();
  }, [faceFramingEnabled, cameraEnabled, cameraStream, recentre]);

  // Back to centre when the camera goes off, so a stale crop is not left on a
  // tile that is now an avatar.
  useEffect(() => {
    if (cameraEnabled) return;
    setLocalFraming(CENTRED);
    publish(CENTRED);
  }, [cameraEnabled, publish]);

  useEffect(() => {
    if (!cameraEnabled) return;
    const beat = window.setInterval(
      () => publish(framingRef.current),
      REPUBLISH_MS,
    );
    return () => window.clearInterval(beat);
  }, [cameraEnabled, publish]);

  return { framingByClient, localFraming, recentre, detecting };
}

export const useVideoFraming = singletonHook(INITIAL, useVideoFramingHook);

/**
 * The framing as a CSS object-position.
 *
 * Mirroring flips the picture, so an offset measured on the unmirrored frame
 * points at the wrong side once it is drawn — the X has to flip with it.
 */
export function toObjectPosition(
  framing: Framing | undefined,
  mirrored?: boolean,
): string {
  const f = framing ?? CENTRED;
  const x = mirrored ? 1 - f.x : f.x;
  return `${(x * 100).toFixed(1)}% ${(f.y * 100).toFixed(1)}%`;
}
