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
 * Everything is best-effort; `buildReport` drops what is missing.
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
    /* Gated on the bridge rather than the string: a web build opened inside
       somebody else's Electron shell would report as the desktop app. */
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

    /* No logs here. A failed connection logs the server address, and a
       self-hosted one is often somebody's house. The form asks first. */
  };
}

/**
 * The version the app actually is. `__APP_VERSION__` is baked in at build time
 * and can disagree with an update staged but not restarted into.
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
 * Electron and Chrome versions, read off the user agent. Not `process.versions`,
 * which the renderer cannot see, and not a new preload call.
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
 * The OS version as the user agent states it. Chrome freezes Windows at 10.0 and
 * macOS at 10.15.7, so this is coarse — but the platform is still the answer.
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
 * Whether this build takes beta updates. Null rather than "stable" when there is
 * no updater at all, which is the web build.
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
 * `4g`, `wifi`, or nothing. Behind the Network Information API, which only Chrome
 * has. Voice breaking on a hotspot and on fibre are different reports.
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
