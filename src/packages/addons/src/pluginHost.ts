/**
 * The app's side of a plugin: one worker each, and the only way in. The addon id
 * comes from which worker a message arrived on, never from the message (GRYT-930).
 */

import { type AddonCapability, declaredCapabilities, grantedCapabilities } from "./capabilities";
import {
  deliverPluginMessage as routeMessage,
  type PluginMessage,
  requireTopic,
  serversRunning,
  subscribe,
} from "./pluginMessages";
import { forgetPanels, hidePanel, showPanel } from "./pluginPanels";
import {
  type HostMessage,
  mayCall,
  METHOD_CAPABILITY,
  readPanel,
  STOP_GRACE_MS,
  type ThemeInfo,
  type WorkerMessage,
} from "./workerProtocol";

/* Re-exported so the addons barrel has one door for the boundary, and a check can
   read the map and the decision where it reads the host. */
export { mayCall, METHOD_CAPABILITY };

/** Set by the app, which owns the sockets. */
type ActivitySetter = (activity: string) => void;
type MessageSender = (pluginId: string, topic: string, data: unknown, host?: string) => void;

let setActivityImpl: ActivitySetter | null = null;
let sendMessageImpl: MessageSender | null = null;

export function setPluginApiActivitySetter(setter: ActivitySetter | null): void {
  setActivityImpl = setter;
}

/*
 * What the person's listed programs are doing. A plain value rather than a fetch:
 * `useSettings` subscribes to the main process and pushes it in (GRYT-931).
 */
let runningPrograms: string[] = [];
const processListeners = new Set<string>();

/** Called by the app whenever the answer changes. */
export function setPluginApiRunningPrograms(running: string[]): void {
  if (running.length === runningPrograms.length && running.every((n, i) => n === runningPrograms[i])) {
    return;
  }
  runningPrograms = [...running];

  for (const addonId of processListeners) {
    pushProcesses(addonId);
  }
}

function pushProcesses(addonId: string): void {
  const entry = running.get(addonId);
  if (!entry) {
    processListeners.delete(addonId);
    return;
  }
  entry.worker.postMessage({
    kind: "event",
    event: "processes",
    payload: [...runningPrograms],
  } satisfies HostMessage);
}

export function setPluginApiMessageSender(sender: MessageSender | null): void {
  sendMessageImpl = sender;
}

interface Running {
  worker: Worker;
  capabilities: AddonCapability[];
  /**
   * The addon's `name` from its manifest, drawn beside a panel title. An id is not
   * a name — "presence" is the folder, "Presence" is what somebody installed.
   */
  name: string;
  /** Dropped when the plugin stops, so a late message reaches nothing. */
  unsubscribes: (() => void)[];
}

const running = new Map<string, Running>();

let currentTheme: ThemeInfo = { appearance: "dark", accentColor: "violet" };
let appVersion = "";

export function setPluginHostTheme(theme: ThemeInfo): void {
  currentTheme = theme;
  for (const { worker } of running.values()) {
    worker.postMessage({ kind: "event", event: "themeChange", payload: theme } satisfies HostMessage);
  }
}

export function setPluginHostVersion(version: string): void {
  appVersion = version;
}

/** Which plugins are running, for the app and for a check to assert on. */
export function runningPlugins(): string[] {
  return [...running.keys()].sort();
}

class Refused extends Error {}

/**
 * Serve one call, or refuse it. Every branch names the capability it needs, and a
 * refusal comes back as a rejected promise rather than as silence.
 */
async function serve(
  addonId: string,
  entry: Running,
  method: string,
  args: unknown[],
): Promise<unknown> {
  const verdict = mayCall(entry.capabilities, grantedCapabilities(addonId), method);
  if (!verdict.allowed) {
    throw new Refused(
      verdict.needs === null
        ? `"${addonId}" called ${method}, which Gryt does not have.`
        : `"${addonId}" has no permission for ${method}. Add "capabilities": ` +
            `["${verdict.needs}"] to its manifest, then allow it in Settings, Addons.`,
    );
  }

  switch (method) {
    case "setActivity": {
      if (!setActivityImpl) throw new Refused("Gryt is not ready to set a status yet.");
      setActivityImpl(typeof args[0] === "string" ? args[0] : "");
      return undefined;
    }

    case "messaging.send": {
      if (!sendMessageImpl) throw new Refused("Gryt is not connected to a server yet.");
      const topic = requireTopic(addonId, args[0]);
      sendMessageImpl(addonId, topic, args[1], typeof args[2] === "string" ? args[2] : undefined);
      return undefined;
    }

    case "messaging.subscribe": {
      const topic = requireTopic(addonId, args[0]);
      /* Subscribed on this side and forwarded in. The worker holds the
         plugin's own handler; this holds the only thing that can reach it. */
      entry.unsubscribes.push(
        subscribe(addonId, topic, (message: PluginMessage) => {
          entry.worker.postMessage({
            kind: "event",
            event: `message:${topic}`,
            payload: message,
          } satisfies HostMessage);
        }),
      );
      return undefined;
    }

    case "messaging.servers": {
      return serversRunning(addonId);
    }

    case "ui.panel": {
      /* Read here rather than trusted: a plugin's rows are built out of what other
         people's clients sent it, and `readPanel` is all that stands before React. */
      const verdict = readPanel(args[0]);
      if (!verdict.ok) throw new Refused(`"${addonId}" sent something that is not a panel: ${verdict.reason}`);
      showPanel(addonId, entry.name, verdict.panel);
      return undefined;
    }

    case "ui.clear": {
      hidePanel(addonId);
      return undefined;
    }

    case "processes.running": {
      return [...runningPrograms];
    }

    case "processes.subscribe": {
      processListeners.add(addonId);
      return undefined;
    }

    default:
      /* Unreachable: `mayCall` refuses anything not in METHOD_CAPABILITY. Here so
         adding an entry and forgetting the branch is a refusal, not undefined. */
      throw new Refused(`"${addonId}" called ${method}, which Gryt does not serve.`);
  }
}

/**
 * Start a plugin in its own worker. `url` is the Vite dev server in development and
 * the app's local server when packaged — same origin as the app either way.
 */
export function startPlugin(
  addonId: string,
  url: string,
  manifestCapabilities: string[] | undefined,
  addonName: string = addonId,
): void {
  stopPlugin(addonId);

  /* The options object has to be a static literal: Vite reads it at build time to
     see this is a module worker. So no `name` carrying the addon id. */
  const worker = new Worker(new URL("./addonWorker.ts", import.meta.url), {
    type: "module",
  });

  const entry: Running = {
    worker,
    capabilities: declaredCapabilities(manifestCapabilities),
    name: addonName,
    unsubscribes: [],
  };
  running.set(addonId, entry);

  worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;

    if (message.kind === "call") {
      serve(addonId, entry, message.method, message.args).then(
        (value) => worker.postMessage({ kind: "result", id: message.id, ok: true, value } satisfies HostMessage),
        (err: unknown) =>
          worker.postMessage({
            kind: "result",
            id: message.id,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies HostMessage),
      );
      return;
    }

    if (message.kind === "log") {
      const line = `[addon:${addonId}] ${message.message}`;
      if (message.level === "error") console.error(line);
      else if (message.level === "warn") console.warn(line);
      else console.info(line);
      return;
    }

    if (message.kind === "failed") {
      console.error(`[AddonLoader] "${addonId}" failed to start:`, message.error);
      stopPlugin(addonId);
    }
  });

  worker.addEventListener("error", (event) => {
    console.error(`[AddonLoader] "${addonId}" crashed:`, event.message);
    stopPlugin(addonId);
  });

  worker.postMessage({
    kind: "load",
    addonId,
    url,
    theme: currentTheme,
    version: appVersion,
  } satisfies HostMessage);
}

/**
 * Stop one, whether or not it cooperates. It is asked first, then terminated
 * regardless — a plugin cannot stay running by never finishing its cleanup.
 */
export function stopPlugin(addonId: string): void {
  const entry = running.get(addonId);
  if (!entry) return;
  running.delete(addonId);

  for (const drop of entry.unsubscribes) drop();
  processListeners.delete(addonId);

  /* Before the worker is asked to stop rather than after. A panel outliving its
     plugin is the failure people notice: off in Settings, still on screen. */
  hidePanel(addonId);

  try {
    entry.worker.postMessage({ kind: "stop" } satisfies HostMessage);
  } catch {
    /* Already gone. Terminating below is the whole of what is left to do. */
  }
  setTimeout(() => entry.worker.terminate(), STOP_GRACE_MS);
}

export function stopAllPlugins(): void {
  for (const addonId of [...running.keys()]) stopPlugin(addonId);
  /* `stopPlugin` already takes each plugin's panel down, so this is for a panel
     whose plugin is no longer in `running` — a start that half failed. */
  forgetPanels();
}

/** Re-exported so the socket layer keeps one import for inbound messages. */
export { routeMessage as deliverPluginMessage };
