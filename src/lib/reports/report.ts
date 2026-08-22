/**
 * The shape `Gryt-chat/reports` takes, and how this app fills it in.
 *
 * `POST /v1/reports`. Only `type` and `message` are required — everything else
 * is diagnostics, and the service is explicit that a field an app gets wrong is
 * truncated or dropped rather than a reason to reject: "a report lost to a
 * validation error is a bug nobody hears about."
 *
 * That cuts both ways, and it is why nothing here throws and nothing here is
 * required to succeed. A diagnostic this app cannot work out is left off rather
 * than sent as a guess, because a wrong Electron version in a bug report is
 * worse than no Electron version.
 *
 * The mobile app fills the same shape from `src/feedback/report.ts`. The two
 * overlap deliberately and diverge where the platforms do: a browser knows its
 * Chrome build and a phone knows its screen scale, and neither should send the
 * other's fields empty.
 */

export type ReportType = "bug" | "feedback";

/** The fields this app can actually fill. The service accepts more. */
export interface Report {
  type: ReportType;
  message: string;
  title?: string;
  /** Only if they offered it. Never read from the account without asking. */
  contact?: string;
  app?: {
    version?: string;
    channel?: string;
    /** Random per install, not per person. What rate limits are counted against. */
    installId?: string;
    locale?: string;
  };
  device?: {
    platform?: string;
    osVersion?: string;
    screen?: { width: number; height: number; scale: number };
    timezone?: string;
  };
  runtime?: {
    engine?: string;
    chromeVersion?: string;
    electronVersion?: string;
    userAgent?: string;
  };
  context?: {
    route?: string;
    serverVersion?: string;
    connected?: boolean;
    voiceActive?: boolean;
    online?: boolean;
    networkType?: string;
    /** "It broke twenty minutes in" and "it broke on launch" are different bugs. */
    sessionUptimeSec?: number;
  };
  /** The tail of the renderer's own log. */
  logs?: string[];
  extra?: Record<string, unknown>;
}

/**
 * What the app knows about itself when somebody opens the form.
 *
 * Passed in rather than read here, so the assembly below stays readable on its
 * own: every one of these comes from somewhere that needs a running app — the
 * Electron bridge, the socket layer, the connection.
 */
export interface Diagnostics {
  version?: string | null;
  channel?: string | null;
  installId?: string | null;
  locale?: string | null;
  platform?: string | null;
  osVersion?: string | null;
  screen?: { width: number; height: number; scale: number } | null;
  timezone?: string | null;
  engine?: string | null;
  chromeVersion?: string | null;
  electronVersion?: string | null;
  userAgent?: string | null;
  route?: string | null;
  serverVersion?: string | null;
  connected?: boolean | null;
  voiceActive?: boolean | null;
  online?: boolean | null;
  networkType?: string | null;
  sessionUptimeSec?: number | null;
  /** Whether this client is running the server it is connected to. */
  embeddedServer?: boolean | null;
  /** The version of that embedded server, which is not the app's. */
  embeddedServerVersion?: string | null;
  logs?: string[];
}

/**
 * The service truncates, but a client should not send a novel either.
 *
 * Generous rather than tight: somebody describing a bug properly is the good
 * case, and cutting them off at a tweet is how you get "it broke" instead.
 */
export const MESSAGE_MAX = 8000;
export const TITLE_MAX = 120;
export const CONTACT_MAX = 200;

/** Trimmed, capped, and undefined rather than empty. */
function text(value: string | null | undefined, max: number): string | undefined {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Only the keys that have a value, or undefined if none of them do. */
function some<T extends object>(entries: T): T | undefined {
  const kept = Object.entries(entries).filter(([, v]) => v !== undefined);
  return kept.length ? (Object.fromEntries(kept) as T) : undefined;
}

function str(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

function bool(value: boolean | null | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function count(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Assemble what gets sent.
 *
 * `type` and `message` always; every diagnostic only if it is actually known.
 * An empty `device` object says "this app does not collect device
 * information", which is a different and wronger claim than leaving it off.
 */
export function buildReport(
  type: ReportType,
  input: { message: string; title?: string; contact?: string },
  diagnostics: Diagnostics = {},
): Report {
  /* The embedded server is two fields on the wire rather than one, because
   * "running its own server" and "which version that server is" answer
   * different questions and the second is often the one that matters. Neither
   * has a column on the service, so they go in `extra`, which is what it is
   * for. */
  const extra = some({
    embeddedServer: bool(diagnostics.embeddedServer),
    embeddedServerVersion: str(diagnostics.embeddedServerVersion),
  });

  return {
    type,
    // Capped rather than validated. The service rejects only an empty message,
    // and the form is what stops it being empty.
    message: text(input.message, MESSAGE_MAX) ?? "",
    title: text(input.title, TITLE_MAX),
    contact: text(input.contact, CONTACT_MAX),
    app: some({
      version: str(diagnostics.version),
      channel: str(diagnostics.channel),
      installId: str(diagnostics.installId),
      locale: str(diagnostics.locale),
    }),
    device: some({
      platform: str(diagnostics.platform),
      osVersion: str(diagnostics.osVersion),
      screen: diagnostics.screen ?? undefined,
      timezone: str(diagnostics.timezone),
    }),
    runtime: some({
      engine: str(diagnostics.engine),
      chromeVersion: str(diagnostics.chromeVersion),
      electronVersion: str(diagnostics.electronVersion),
      userAgent: str(diagnostics.userAgent),
    }),
    context: some({
      route: str(diagnostics.route),
      serverVersion: str(diagnostics.serverVersion),
      connected: bool(diagnostics.connected),
      voiceActive: bool(diagnostics.voiceActive),
      online: bool(diagnostics.online),
      networkType: str(diagnostics.networkType),
      sessionUptimeSec: count(diagnostics.sessionUptimeSec),
    }),
    logs: diagnostics.logs?.length ? diagnostics.logs : undefined,
    extra,
  };
}

/** "2 min", not "127 s". A duration somebody reads, not a field. */
function uptime(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  if (seconds < 90) return `${seconds} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/**
 * `win32` on the wire, "Windows" on the screen.
 *
 * Only for the list somebody reads before sending, where a bare `darwin` next
 * to a version number reads as a typo.
 */
function platformLabel(platform: string): string {
  if (platform === "darwin" || platform === "macos") return "macOS";
  if (platform === "win32" || platform === "windows") return "Windows";
  if (platform === "linux") return "Linux";
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

/**
 * The same diagnostics, as lines to show somebody before they send.
 *
 * A form that quietly ships a route, a server version and a log tail is worse
 * than one that says so — and this is the list that makes "what is attached"
 * answerable without reading the source. It is built from the report rather
 * than from the inputs, so it cannot drift from what actually goes.
 */
export function describeAttached(report: Report): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value) lines.push({ label, value });
  };

  const device = report.device;
  add("Gryt", report.app?.version && `v${report.app.version}`);
  add("Channel", report.app?.channel);
  add(
    "System",
    device?.platform && device?.osVersion
      ? `${platformLabel(device.platform)} ${device.osVersion}`
      : device?.platform && platformLabel(device.platform),
  );
  add("Electron", report.runtime?.electronVersion);
  add("Chrome", report.runtime?.chromeVersion);
  add(
    "Window",
    device?.screen
      ? `${device.screen.width}×${device.screen.height} @${device.screen.scale}x`
      : undefined,
  );
  add("Timezone", device?.timezone);
  add("Where you were", report.context?.route);
  add("Running for", uptime(report.context?.sessionUptimeSec));
  add("Server", report.context?.serverVersion);
  add("In voice", report.context?.voiceActive ? "yes" : undefined);
  add(
    "Own server",
    report.extra?.embeddedServer
      ? String(report.extra.embeddedServerVersion ?? "yes")
      : undefined,
  );
  add("Log", report.logs?.length ? `last ${report.logs.length} lines` : undefined);
  add("Install", report.app?.installId);

  return lines;
}
