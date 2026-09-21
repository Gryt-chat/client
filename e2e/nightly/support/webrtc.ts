import type { BrowserContext, Page } from "@playwright/test";

export interface CandidateStats {
  address: string;
  port: number;
  type: string;
  protocol: string;
}

export interface PeerStats {
  /** Summed over every open peer connection the page made. */
  audioBytesReceived: number;
  videoFramesDecoded: number;
  /** The far end of each open connection's selected candidate pair. */
  remotes: CandidateStats[];
  /** Every address the SFU offered, from its SDP and from trickled candidates. */
  offered: string[];
}

/**
 * Keeps every RTCPeerConnection the app makes, so a test can read getStats. With `hideLocal`, the
 * SFU never learns this machine's addresses, so a run from the SFU's own LAN still takes the public path.
 */
export async function watchPeerConnections(context: BrowserContext, hideLocal: boolean): Promise<void> {
  await context.addInitScript((hide: boolean) => {
    const Native = window.RTCPeerConnection;
    const open: RTCPeerConnection[] = [];
    const offered = new Set<string>();
    Object.defineProperty(window, "__grytPeers", { value: { open, offered } });

    const noteCandidates = (sdp: string | undefined) => {
      for (const line of sdp?.split("\r\n") ?? []) {
        if (line.startsWith("a=candidate:")) offered.add(line.split(" ")[4]);
      }
    };
    const stripped = (description: RTCSessionDescription | null) => {
      if (!hide || !description) return description;
      const lines = description.sdp.split("\r\n");
      const sdp = lines.filter((l) => !l.startsWith("a=candidate:") && l !== "a=end-of-candidates").join("\r\n");
      return new RTCSessionDescription({ type: description.type, sdp });
    };

    class Watched extends Native {
      constructor(config?: RTCConfiguration) {
        super(config);
        open.push(this);
        // Registered before the app's handler, so stopping it here keeps the candidate from the SFU.
        this.addEventListener("icecandidate", (event) => {
          if (hide && event.candidate) event.stopImmediatePropagation();
        });
      }

      get localDescription() {
        return stripped(super.localDescription);
      }

      get currentLocalDescription() {
        return stripped(super.currentLocalDescription);
      }

      get pendingLocalDescription() {
        return stripped(super.pendingLocalDescription);
      }

      setRemoteDescription(description: RTCSessionDescriptionInit) {
        noteCandidates(description.sdp);
        return super.setRemoteDescription(description);
      }

      addIceCandidate(candidate?: RTCIceCandidateInit | null) {
        noteCandidates(candidate?.candidate ? `a=${candidate.candidate}` : undefined);
        return super.addIceCandidate(candidate ?? undefined);
      }
    }

    Object.defineProperty(window, "RTCPeerConnection", { value: Watched, configurable: true, writable: true });
  }, hideLocal);
}

/** How many of the page's peer connections have finished connecting. */
export function connectedPeers(page: Page): Promise<number> {
  return page.evaluate(() => {
    const peers = (window as unknown as { __grytPeers?: { open: RTCPeerConnection[] } }).__grytPeers;
    return (peers?.open ?? []).filter((pc) => pc.connectionState === "connected").length;
  });
}

/** One read of getStats across the page's open peer connections. */
export function peerStats(page: Page): Promise<PeerStats> {
  return page.evaluate(async () => {
    const peers = (window as unknown as { __grytPeers?: { open: RTCPeerConnection[]; offered: Set<string> } })
      .__grytPeers;
    const result = { audioBytesReceived: 0, videoFramesDecoded: 0, remotes: [] as CandidateStats[], offered: [] as string[] };
    if (!peers) return result;
    result.offered = [...peers.offered];

    for (const pc of peers.open) {
      if (pc.connectionState === "closed") continue;
      const report = await pc.getStats();
      const byId = new Map<string, Record<string, unknown>>();
      report.forEach((entry: Record<string, unknown>) => byId.set(entry.id as string, entry));

      for (const entry of byId.values()) {
        if (entry.type === "inbound-rtp" && entry.kind === "audio") {
          result.audioBytesReceived += Number(entry.bytesReceived ?? 0);
        }
        if (entry.type === "inbound-rtp" && entry.kind === "video") {
          result.videoFramesDecoded += Number(entry.framesDecoded ?? 0);
        }
        if (entry.type === "transport" && entry.selectedCandidatePairId) {
          const pair = byId.get(entry.selectedCandidatePairId as string);
          const remote = pair && byId.get(pair.remoteCandidateId as string);
          if (remote) {
            result.remotes.push({
              address: String(remote.address ?? remote.ip),
              port: Number(remote.port),
              type: String(remote.candidateType),
              protocol: String(remote.protocol),
            });
          }
        }
      }
    }
    return result;
  });
}

/** The first encoding's priority on each video sender that is sending something, sorted. */
export function videoSendPriorities(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const peers = (window as unknown as { __grytPeers?: { open: RTCPeerConnection[] } }).__grytPeers;
    return (peers?.open ?? [])
      .filter((pc) => pc.connectionState !== "closed")
      .flatMap((pc) => pc.getSenders())
      .filter((sender) => sender.track?.kind === "video")
      .map((sender) => sender.getParameters().encodings[0]?.priority ?? "none")
      .sort();
  });
}

/** Loopback, RFC 1918, link-local, CGNAT, IPv6 unique-local and mDNS names. */
export function isPrivateAddress(address: string): boolean {
  if (address.endsWith(".local")) return true;
  if (address.includes(":")) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower.startsWith("fe80:") || /^f[cd]/.test(lower);
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
