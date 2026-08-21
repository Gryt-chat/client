/**
 * Work out which hop between this client and a server is broken.
 *
 * Every voice support thread starts the same way: chat works, voice does not,
 * and finding out which part is unreachable means somebody reading an SFU log
 * by hand. The client already knows enough to answer that itself.
 *
 * The checks run in the order the connection does, so the first failure is the
 * one to act on. Anything after it is reported as untested rather than as
 * passing or failing, because a later hop cannot be judged when an earlier one
 * is down.
 */

export type CheckId =
  | "server-http"
  | "server-socket"
  | "sfu-http"
  | "sfu-ws"
  | "media";

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
 * Whether UDP leaves this machine at all.
 *
 * There is no way to test the SFU's media port directly: a renderer cannot
 * send raw UDP, so nothing here can open 3478 and see who answers. What it can
 * do is gather ICE candidates against the configured STUN servers, which
 * exercises the same outbound UDP path media would take.
 *
 * So this is deliberately narrower than it looks, and the wording says so. A
 * pass means UDP gets out and a public address came back. It does not prove
 * the SFU's port is open, and claiming otherwise would send people to check
 * the wrong thing.
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

export interface DoctorInput {
  /** The address the person typed to add this server. */
  host: string;
  /** Whether the socket to that server is up right now. */
  socketConnected: boolean;
  sfuHosts: string[];
  stunHosts: string[];
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
  set("media", await checkMedia(input.stunHosts));

  return results;
}

/** The one thing to do next, or null when everything passed. */
export function summarise(results: CheckResult[]): CheckResult | null {
  return results.find((r) => r.status === "fail") ?? results.find((r) => r.status === "warn") ?? null;
}
