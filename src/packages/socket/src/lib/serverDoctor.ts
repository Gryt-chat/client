/**
 * Work out which hop between this client and a server is broken, so "chat works
 * and voice does not" does not mean reading an SFU log by hand.
 *
 * The checks run in the order the connection does, so the first failure is the
 * one to act on. **Anything after it is reported as untested**, never as
 * passing or failing.
 */

export type CheckId =
  | "server-http"
  | "server-socket"
  | "sfu-http"
  | "sfu-ws"
  | "media"
  | "call";

export type CheckStatus = "pending" | "running" | "pass" | "fail" | "warn" | "skipped";

export interface CheckResult {
  id: CheckId;
  label: string;
  status: CheckStatus;
  /** One line saying what happened. Shown whether it passed or not. */
  detail?: string;
  /** Per-address findings, for the checks that try more than one. */
  addresses?: { address: string; ok: boolean; latencyMs?: number; error?: string }[];
  /** Anchor in the troubleshooting guide that covers this failure. */
  help?: { label: string; href: string };
}

const DOCS = "https://docs.gryt.chat/docs/guide/troubleshooting";

const HELP = {
  server: {
    label: "Server unreachable",
    href: `${DOCS}#websocket-connection-fails`,
  },
  sfu: {
    label: "SFU connection fails",
    href: `${DOCS}#sfu-connection-fails`,
  },
  media: {
    label: "Chat works but nobody can hear anyone",
    href: `${DOCS}#people-connect-and-chat-but-nobody-can-hear-anyone`,
  },
} as const;

const PROBE_TIMEOUT_MS = 4000;
const ICE_TIMEOUT_MS = 10000;
const CALL_TIMEOUT_MS = 15000;

/**
 * Whether this client is allowed to speak plain ws/http at all.
 *
 * The rule is the browser's, not ours: an HTTPS page may not open a plain
 * connection to anything but localhost. The desktop app serves its client from
 * http://127.0.0.1, so it is exempt; app.gryt.chat is not.
 */
function isHttpsPage(): boolean {
  try {
    return typeof window !== "undefined" && window.location?.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * One advertised address, as a WebSocket URL this client could actually use.
 *
 * Deliberately not the voice engine's version of this. That one caches a
 * choice for the session and falls back to the first address when everything
 * fails, which is the behaviour being diagnosed. Here each address is taken at
 * face value and tried on its own.
 */
function sfuWsUrl(raw: string): string {
  const hasScheme = raw.startsWith("ws://") || raw.startsWith("wss://");

  try {
    const url = new URL(hasScheme ? raw : `ws://${raw}`);
    url.protocol = isHttpsPage() ? "wss:" : "ws:";
    return url.toString();
  } catch {
    return hasScheme ? raw : `ws://${raw}`;
  }
}

function healthUrlFor(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/?$/, "/health");
}

function httpBase(host: string): string {
  if (host.startsWith("http://") || host.startsWith("https://")) return host;
  return `http://${host}`;
}

/** A fetch that gives up rather than hanging, and reports how long it took. */
async function probe(
  url: string,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store" });
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    // An abort and a refused connection are different problems to the person
    // reading this: one is a firewall swallowing packets, the other is nothing
    // listening. The distinction survives into the message.
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: aborted ? `no answer within ${PROBE_TIMEOUT_MS / 1000}s` : "refused",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function initialChecks(): CheckResult[] {
  return [
    { id: "server-http", label: "Server reachable", status: "pending" },
    { id: "server-socket", label: "Server connection", status: "pending" },
    { id: "sfu-http", label: "Voice signalling reachable", status: "pending" },
    { id: "sfu-ws", label: "Voice signalling accepts a connection", status: "pending" },
    { id: "media", label: "Voice and video path", status: "pending" },
    { id: "call", label: "A real call to this server", status: "pending" },
  ];
}

async function checkServerHttp(host: string): Promise<CheckResult> {
  const result = await probe(`${httpBase(host)}/health`);

  if (result.ok) {
    return {
      id: "server-http",
      label: "Server reachable",
      status: "pass",
      detail: `${host} answered in ${result.latencyMs} ms`,
    };
  }

  return {
    id: "server-http",
    label: "Server reachable",
    status: "fail",
    detail: `${host} ${result.error}. Chat and joining go over this address, so nothing will work until it does.`,
    help: HELP.server,
  };
}

/**
 * Every advertised SFU address, tried separately.
 *
 * The one that matters most. `server:details` hands the client a list and it
 * picks whichever answers fastest, so a person whose LAN address is in that
 * list and whose public one is not sees "voice is broken" rather than "two of
 * these three are not reachable from here".
 */
async function checkSfuHttp(sfuHosts: string[]): Promise<CheckResult> {
  if (sfuHosts.length === 0) {
    return {
      id: "sfu-http",
      label: "Voice signalling reachable",
      status: "fail",
      detail: "This server advertises no address for voice at all.",
      help: HELP.sfu,
    };
  }

  const addresses = await Promise.all(
    sfuHosts.map(async (raw) => {
      const result = await probe(healthUrlFor(sfuWsUrl(raw)));
      return {
        address: raw,
        ok: result.ok,
        latencyMs: result.latencyMs,
        error: result.error,
      };
    }),
  );

  const reachable = addresses.filter((a) => a.ok);

  if (reachable.length === 0 && isHttpsPage()) {
    return {
      id: "sfu-http",
      label: "Voice signalling reachable",
      status: "fail",
      detail:
        "This is the browser client, which may only open secure connections. A server on a plain IP address cannot be reached from here no matter how it is configured, and the desktop app is the way round it.",
      addresses,
      help: HELP.sfu,
    };
  }

  if (reachable.length === 0) {
    return {
      id: "sfu-http",
      label: "Voice signalling reachable",
      status: "fail",
      detail:
        addresses.length === 1
          ? "The only address advertised for voice cannot be reached from here."
          : `None of the ${addresses.length} addresses advertised for voice can be reached from here.`,
      addresses,
      help: HELP.sfu,
    };
  }

  // Some reachable and some not is normal rather than wrong: a server usually
  // advertises a LAN address and a public one, and any given person is on one
  // side or the other. Saying so stops a green tick looking like a lie.
  return {
    id: "sfu-http",
    label: "Voice signalling reachable",
    status: reachable.length === addresses.length ? "pass" : "warn",
    detail:
      reachable.length !== addresses.length
        ? `${reachable.length} of ${addresses.length} answered, which is normal if the others are for people on a different network.`
        : addresses.length === 1
          ? "The address advertised for voice answered."
          : `All ${addresses.length} advertised addresses answered.`,
    addresses,
  };
}

/** The upgrade, which can fail on its own even when /health answers. */
function checkSfuWebSocket(url: string): Promise<CheckResult> {
  return new Promise((resolve) => {
    const label = "Voice signalling accepts a connection";
    let settled = false;

    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      finish({
        id: "sfu-ws",
        label,
        status: "fail",
        detail: `Could not open a connection to ${url}.`,
        help: HELP.sfu,
      });
      return;
    }

    const timer = setTimeout(() => {
      ws.close();
      finish({
        id: "sfu-ws",
        label,
        status: "fail",
        detail: `${url} answered a health check but never completed a connection.`,
        help: HELP.sfu,
      });
    }, PROBE_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(timer);
      ws.close();
      finish({ id: "sfu-ws", label, status: "pass", detail: `Connected to ${url}.` });
    };

    ws.onerror = () => {
      clearTimeout(timer);
      finish({
        id: "sfu-ws",
        label,
        status: "fail",
        detail: `${url} refused the connection.`,
        help: HELP.sfu,
      });
    };
  });
}

/**
 * Whether UDP leaves this machine at all. A renderer cannot send raw UDP, so
 * this gathers ICE candidates against the STUN servers instead, exercising the
 * same outbound path.
 *
 * **Narrower than it looks, and the wording says so.** A pass means UDP gets
 * out and a public address came back; it does not prove the SFU's port is open.
 */
function checkMedia(stunHosts: string[]): Promise<CheckResult> {
  return new Promise((resolve) => {
    const label = "Voice and video path";

    if (typeof RTCPeerConnection === "undefined") {
      resolve({
        id: "media",
        label,
        status: "skipped",
        detail: "This client cannot test WebRTC.",
      });
      return;
    }

    const iceServers = stunHosts.length > 0 ? [{ urls: stunHosts }] : [];
    const pc = new RTCPeerConnection({ iceServers });

    let host = 0;
    let srflx = 0;
    let settled = false;

    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      pc.close();
      resolve(result);
    };

    const verdict = () => {
      if (srflx > 0) {
        finish({
          id: "media",
          label,
          status: "pass",
          detail: `UDP leaves this machine: ${host} local and ${srflx} public candidate${srflx === 1 ? "" : "s"}. This does not prove the server's media port is open, only that this end can send.`,
        });
        return;
      }

      if (host > 0) {
        finish({
          id: "media",
          label,
          status: "warn",
          detail: `Found ${host} local candidate${host === 1 ? "" : "s"} but no public one, so STUN got no answer. On mobile data this is expected and voice will not connect; on Wi-Fi it usually means UDP is blocked.`,
          help: HELP.media,
        });
        return;
      }

      finish({
        id: "media",
        label,
        status: "fail",
        detail: "No network candidates at all, so this machine cannot open a media connection to anything.",
        help: HELP.media,
      });
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        verdict();
        return;
      }
      if (event.candidate.type === "srflx") srflx += 1;
      if (event.candidate.type === "host") host += 1;
    };

    setTimeout(verdict, ICE_TIMEOUT_MS);

    pc.createDataChannel("gryt-doctor");
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() =>
        finish({
          id: "media",
          label,
          status: "fail",
          detail: "WebRTC refused to start on this machine.",
          help: HELP.media,
        }),
      );
  });
}

/**
 * The route media took. **Found through `selectedCandidatePairId`, not a pair
 * flagged `nominated`** — nomination is the SFU's job here, and Chrome reports
 * `nominated: false` on every pair including the one it is using, so filtering
 * on it degrades this line to "media flowed".
 */
function describeSelectedPair(stats: RTCStatsReport): string {
  const generic = "Connected to the voice server and media flowed.";

  let selectedId: string | undefined;
  let succeeded: RTCIceCandidatePairStats | undefined;

  stats.forEach((report) => {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      selectedId = report.selectedCandidatePairId as string;
    }
    if (report.type === "candidate-pair" && report.state === "succeeded") {
      succeeded = report as RTCIceCandidatePairStats;
    }
  });

  const pair =
    (selectedId ? (stats.get(selectedId) as RTCIceCandidatePairStats | undefined) : undefined) ??
    succeeded;
  if (!pair) return generic;

  const local = stats.get(pair.localCandidateId ?? "");
  const remote = stats.get(pair.remoteCandidateId ?? "");
  if (!local || !remote) return generic;

  return `Connected. Media took ${local.candidateType} → ${remote.candidateType}, reaching the server at ${remote.address}:${remote.port} over ${String(remote.protocol ?? "udp").toUpperCase()}.`;
}

/**
 * What the server hands back for a throwaway test room.
 *
 * `join_token` is not a token. It is the whole join payload the SFU expects —
 * room, server, server password and the user's own token — and it goes across
 * as the body of `client_join` unchanged. Sending anything else, including a
 * tidier object built out of its parts, gets the connection refused, because
 * the SFU validates the server id and password inside it.
 */
export interface DoctorRoomGrant {
  room_id: string;
  join_token: {
    room_id: string;
    server_id: string;
    server_password: string;
    user_token: string;
    user_id: string;
  };
  sfu_urls?: string[];
  sfu_url?: string;
}

/**
 * Ask the SFU for a real connection into an empty room. The checks above prove
 * it is reachable; this proves media gets through, which a firewall passing TCP
 * 5005 and dropping UDP 3478 does not. The prize is `selectedPair`.
 */
async function checkCall(
  grant: DoctorRoomGrant,
  stunHosts: string[],
): Promise<CheckResult> {
  const label = "A real call to this server";

  if (typeof RTCPeerConnection === "undefined") {
    return { id: "call", label, status: "skipped", detail: "This client cannot test WebRTC." };
  }

  const url = sfuWsUrl(grant.sfu_urls?.[0] ?? grant.sfu_url ?? "");
  const pc = new RTCPeerConnection({
    iceServers: stunHosts.length > 0 ? [{ urls: stunHosts }] : [],
  });
  const ws = new WebSocket(url);

  // Something to negotiate. A data channel rather than a microphone: this must
  // not ask for a device, and a permission prompt in the middle of a
  // diagnostic would be its own bug report.
  pc.createDataChannel("gryt-doctor");

  const cleanUp = () => {
    pc.close();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  };

  return new Promise<CheckResult>((resolve) => {
    let settled = false;

    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      cleanUp();
      resolve(result);
    };

    const timer = setTimeout(
      () =>
        finish({
          id: "call",
          label,
          status: "fail",
          detail: `Negotiation started but never connected within ${CALL_TIMEOUT_MS / 1000}s. Signalling works and media does not, which almost always means the UDP port is closed or the network drops UDP.`,
          help: HELP.media,
        }),
      CALL_TIMEOUT_MS,
    );

    ws.onerror = () =>
      finish({
        id: "call",
        label,
        status: "fail",
        detail: `Could not open a connection to ${url}.`,
        help: HELP.sfu,
      });

    ws.onopen = () => {
      // The grant's join_token verbatim. See DoctorRoomGrant: it is the
      // payload, not a credential to wrap in one.
      ws.send(
        JSON.stringify({
          event: "client_join",
          data: JSON.stringify(grant.join_token),
        }),
      );
    };

    ws.onmessage = (event) => {
      let message: { event?: string; data?: string };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.event === "error") {
        finish({
          id: "call",
          label,
          status: "fail",
          detail: `The voice server refused the test room: ${message.data ?? "no reason given"}.`,
          help: HELP.sfu,
        });
        return;
      }

      // Offer and candidates are the engine's protocol, not this one's, and
      // repeating it here would be a second copy to keep in step. ICE state is
      // enough for a yes or no, so the negotiation is left to the peer
      // connection and only the outcome is read.
      if (message.event === "offer" && message.data) {
        void (async () => {
          try {
            await pc.setRemoteDescription(JSON.parse(message.data as string));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            ws.send(JSON.stringify({ event: "answer", data: JSON.stringify(answer) }));
          } catch {
            finish({
              id: "call",
              label,
              status: "fail",
              detail: "The voice server offered a connection this client could not answer.",
              help: HELP.media,
            });
          }
        })();
      }

      if (message.event === "candidate" && message.data) {
        try {
          void pc.addIceCandidate(JSON.parse(message.data as string));
        } catch {
          // A candidate that will not parse is not on its own a failure: ICE
          // needs one working pair, not every pair.
        }
      }
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ event: "candidate", data: JSON.stringify(event.candidate) }));
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        clearTimeout(timer);
        finish({
          id: "call",
          label,
          status: "fail",
          detail:
            "ICE tried every path it had and none worked. Gryt has no relay, so a network that will not pass UDP cannot carry a call.",
          help: HELP.media,
        });
        return;
      }

      if (pc.iceConnectionState !== "connected" && pc.iceConnectionState !== "completed") {
        return;
      }

      clearTimeout(timer);

      void pc
        .getStats()
        .then((stats) => {
          finish({
            id: "call",
            label,
            status: "pass",
            detail: describeSelectedPair(stats),
          });
        })
        .catch(() =>
          finish({
            id: "call",
            label,
            status: "pass",
            detail: "Connected to the voice server and media flowed.",
          }),
        );
    };
  });
}

export interface DoctorInput {
  /** The address the person typed to add this server. */
  host: string;
  /** Whether the socket to that server is up right now. */
  socketConnected: boolean;
  sfuHosts: string[];
  stunHosts: string[];
  /**
   * Asks the server for a throwaway room, or null when the caller does not
   * want a real call attempted. Left out, the Doctor stops at "the SFU is
   * reachable" and says the last check was not run.
   */
  requestDoctorRoom?: () => Promise<DoctorRoomGrant>;
}

/**
 * Run the checks in connection order, reporting each as it lands.
 *
 * `onUpdate` fires after every check so the modal fills in rather than sitting
 * blank: the SFU probes alone can take four seconds against an address that is
 * being dropped rather than refused.
 */
export async function runDoctor(
  input: DoctorInput,
  onUpdate: (results: CheckResult[]) => void,
): Promise<CheckResult[]> {
  const results = initialChecks();

  const set = (id: CheckId, patch: Partial<CheckResult>) => {
    const index = results.findIndex((r) => r.id === id);
    if (index >= 0) results[index] = { ...results[index], ...patch };
    onUpdate([...results]);
  };

  set("server-http", { status: "running" });
  const serverHttp = await checkServerHttp(input.host);
  set("server-http", serverHttp);

  set("server-socket", {
    status: input.socketConnected ? "pass" : "fail",
    detail: input.socketConnected
      ? "Chat and presence are connected."
      : "Not connected. Chat will not work either, so this is the thing to fix first.",
    help: input.socketConnected ? undefined : HELP.server,
  });

  // A server that cannot be reached has not told this client where its SFU is,
  // so the remaining checks would be testing a list that does not exist.
  if (serverHttp.status === "fail") {
    for (const id of ["sfu-http", "sfu-ws", "media"] as CheckId[]) {
      set(id, {
        status: "skipped",
        detail: "Not tested, because the server itself could not be reached.",
      });
    }
    return results;
  }

  set("sfu-http", { status: "running" });
  const sfuHttp = await checkSfuHttp(input.sfuHosts);
  set("sfu-http", sfuHttp);

  const firstReachable = sfuHttp.addresses?.find((a) => a.ok)?.address;

  if (!firstReachable) {
    set("sfu-ws", {
      status: "skipped",
      detail: "Not tested, because no voice address answered.",
    });
  } else {
    set("sfu-ws", { status: "running" });
    set("sfu-ws", await checkSfuWebSocket(sfuWsUrl(firstReachable)));
  }

  set("media", { status: "running" });
  const media = await checkMedia(input.stunHosts);
  set("media", media);

  if (!input.requestDoctorRoom) {
    set("call", {
      status: "skipped",
      detail: "Not tested. This client cannot ask the server for a test room.",
    });
    return results;
  }

  if (!firstReachable) {
    set("call", {
      status: "skipped",
      detail: "Not tested, because no voice address answered.",
    });
    return results;
  }

  set("call", { status: "running" });

  // The grant and the call are separate failures and used to share a message.
  // A WebSocket this client could not construct was reported as the server
  // refusing a room, which sends somebody to look at a server that did exactly
  // what it was asked.
  let grant: DoctorRoomGrant;
  try {
    grant = await input.requestDoctorRoom();
  } catch (err) {
    set("call", {
      status: "fail",
      detail:
        err instanceof Error
          ? `The server would not open a test room: ${err.message}`
          : "The server would not open a test room.",
      help: HELP.sfu,
    });
    return results;
  }

  try {
    set("call", await checkCall(grant, input.stunHosts));
  } catch (err) {
    set("call", {
      status: "fail",
      detail:
        err instanceof Error
          ? `The test call could not be started: ${err.message}`
          : "The test call could not be started.",
      help: HELP.media,
    });
  }

  return results;
}

/** The one thing to do next, or null when everything passed. */
export function summarise(results: CheckResult[]): CheckResult | null {
  return results.find((r) => r.status === "fail") ?? results.find((r) => r.status === "warn") ?? null;
}
