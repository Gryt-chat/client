import type { Diagnostics } from "@gryt/core";
import { useSFU } from "@gryt/voice";
import { useEffect, useState } from "react";

import { useEmbeddedServer } from "@/settings/src/hooks/useEmbeddedServer";
import { useServerManagement, useSockets } from "@/socket";

import { getElectronAPI, isElectron } from "../electron";
import { installId } from "./installId";
import { lastPlace, sessionUptimeSec } from "./session";

/**
 * What the app knows about itself, for a report nobody should have to fill in.
 *
 * The service's README is blunt about which of these matter: app version, build
 * number and OS version are "the ones every bug report needs and nobody
 * remembers to include". The desktop build can answer more than that — Electron
 * and Chrome versions, whether it is running its own server, the tail of the
 * renderer log — and those are the fields that make a voice bug diagnosable.
 * None of them survive a round trip through a GitHub issue form.
 *
 * Everything here is best-effort and nullable. `buildReport` drops what is
 * missing rather than sending a guess.
 */
export function useDiagnostics(): Diagnostics {
  const { serverDetailsList } = useSockets();
  const { currentlyViewingServer } = useServerManagement();
  const { isConnected } = useSFU();
  const { servers: embedded, bundled } = useEmbeddedServer();

  const version = useAppVersion();
  const channel = useChannel();
  const online = useOnline();

  const viewing = currentlyViewingServer
    ? serverDetailsList[currentlyViewingServer.host]
    : undefined;

  /* Running, not merely configured. A stopped server this machine happens to
   * own says nothing about the bug being reported. */
  const running = embedded.find((s) => s.status === "running") ?? null;

  const ua = readUserAgent();

  return {
    version,
    channel,
    installId: installId(),
    locale: navigator.language || null,

    platform: readPlatform(),
    osVersion: ua.osVersion,
    screen: {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: window.devicePixelRatio,
    },
    timezone: safeTimezone(),

    engine: isElectron() ? "electron" : "browser",
    chromeVersion: ua.chrome,
    /* Gated on the bridge rather than taken from the string. A web build can
       be opened inside somebody else's Electron shell — that is how the
       preview browser runs — and reporting its version would say this was the
       desktop app when nothing else about the report is. */
    electronVersion: isElectron() ? ua.electron : null,
    userAgent: navigator.userAgent || null,

    /* Where they were before the form, not the form. See `session.ts`. */
    route: lastPlace(),
    serverVersion: viewing?.server_info?.version ?? null,
    connected: currentlyViewingServer ? Boolean(viewing) : null,
    voiceActive: isConnected,
    online,
    networkType: readNetworkType(),
    sessionUptimeSec: sessionUptimeSec(),

    embeddedServer: isElectron() ? running !== null : null,
    embeddedServerVersion: bundled?.server ?? null,

    /* No logs here. They are the one field that can carry something about the
       person rather than about the build — a failed connection logs the server
       address, and a self-hosted server's address is often somebody's house.
       The form asks before attaching them; see `logs.ts`. */
  };
}

/**
 * The version the app actually is.
 *
 * `__APP_VERSION__` is the one baked in at build time and is right in the
 * browser. On the desktop it can disagree with what is installed — an update
 * that has been staged but not restarted into — so the main process is asked
 * first and the constant is the fallback while it answers.
 */
function useAppVersion(): string {
  const [version, setVersion] = useState(__APP_VERSION__);

  useEffect(() => {
    getElectronAPI()
      ?.getAppVersion()
      .then(setVersion)
      .catch(() => {
        // The constant is already there and is nearly always the same answer.
      });
  }, []);

  return version;
}

/** Whether the browser thinks there is a network, watched rather than sampled. */
function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

/**
 * Electron and Chrome versions, read off the user agent.
 *
 * Not from `process.versions`, which the renderer cannot see under context
 * isolation, and not through a new bridge call — Electron puts both in the user
 * agent already, and a preload addition is a whole release before an older
 * build can send one.
 */
function readUserAgent(): {
  chrome: string | null;
  electron: string | null;
  osVersion: string | null;
} {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return {
    chrome: /Chrome\/([\d.]+)/.exec(ua)?.[1] ?? null,
    electron: /Electron\/([\d.]+)/.exec(ua)?.[1] ?? null,
    osVersion: readOsVersion(ua),
  };
}

/**
 * The OS version as the user agent states it.
 *
 * Coarse on purpose and coarser than it used to be: Chrome freezes the Windows
 * version at 10.0 and macOS at 10.15.7 whatever the machine is running. Worth
 * sending anyway — "Windows" and "macOS" are still the answer to which platform
 * this is, and the frozen number is at least not a wrong one.
 */
function readOsVersion(ua: string): string | null {
  return (
    /Windows NT ([\d.]+)/.exec(ua)?.[1] ??
    /Mac OS X ([\d_.]+)/.exec(ua)?.[1]?.replace(/_/g, ".") ??
    /Android ([\d.]+)/.exec(ua)?.[1] ??
    null
  );
}

function readPlatform(): string | null {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/.test(ua)) return "win32";
  if (/Mac OS X|Macintosh/.test(ua)) return "darwin";
  if (/Linux|X11/.test(ua)) return "linux";
  return null;
}

/**
 * Whether this build takes beta updates.
 *
 * Null rather than "stable" when there is no updater at all, which is the web
 * build — it has no channel, and saying "stable" would claim otherwise.
 */
function useChannel(): string | null {
  const [channel, setChannel] = useState<string | null>(null);

  useEffect(() => {
    getElectronAPI()
      ?.getBetaChannel()
      .then((beta) => setChannel(beta ? "beta" : "stable"))
      .catch(() => {
        // Leave it unset rather than guessing at a channel.
      });
  }, []);

  return channel;
}

/**
 * `4g`, `wifi`, or nothing.
 *
 * Behind the Network Information API, which Chrome has and nothing else does.
 * Worth asking for anyway: voice breaking on a phone hotspot and voice breaking
 * on fibre are different reports.
 */
function readNetworkType(): string | null {
  const connection = (
    navigator as Navigator & { connection?: { effectiveType?: string; type?: string } }
  ).connection;
  return connection?.type || connection?.effectiveType || null;
}

/** `Intl` is always there, but a report is not worth a crash if it is not. */
function safeTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
