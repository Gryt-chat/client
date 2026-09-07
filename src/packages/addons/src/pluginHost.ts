/**
 * The app's side of a plugin (GRYT-930).
 *
 * One worker per plugin, and this is the only way into the app from inside one.
 * Every message that arrives is checked against what that addon declared and
 * was granted before anything happens — and unlike the arrangement this
 * replaced, refusing here is the end of it. A plugin has no `window`, no DOM
 * and none of the app's modules, so there is no second route to the thing it
 * was refused.
 *
 * The addon id is never read from a message. It comes from which worker the
 * message arrived on, so a plugin cannot act as another by saying it is one.
 */

import { type AddonCapability, declaredCapabilities, grantedCapabilities } from "./capabilities";
import {
  deliverPluginMessage as routeMessage,
  type PluginMessage,
  requireTopic,
  serversRunning,
  subscribe,
} from "./pluginMessages";
import {
  type HostMessage,
  mayCall,
  METHOD_CAPABILITY,
  STOP_GRACE_MS,
  type ThemeInfo,
  type WorkerMessage,
} from "./workerProtocol";

/* Re-exported so the addons barrel has one door for the boundary, and so a
   check can read the map and the decision from the same place it reads the
   host. */
export { mayCall, METHOD_CAPABILITY };

/** Set by the app, which owns the sockets. */
type ActivitySetter = (activity: string) => void;
type MessageSender = (pluginId: string, topic: string, data: unknown, host?: string) => void;

let setActivityImpl: ActivitySetter | null = null;
let sendMessageImpl: MessageSender | null = null;

export function setPluginApiActivitySetter(setter: ActivitySetter | null): void {
  setActivityImpl = setter;
}

export function setPluginApiMessageSender(sender: MessageSender | null): void {
  sendMessageImpl = sender;
}

interface Running {
  worker: Worker;
  capabilities: AddonCapability[];
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
 * Serve one call, or refuse it.
 *
 * Every branch names the capability it needs. A refusal comes back as a
 * rejected promise inside the plugin rather than as silence, because a plugin
 * author who has forgotten a manifest line should find out at the call.
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

    default:
      /* Unreachable: `mayCall` refuses anything not in METHOD_CAPABILITY, and
         every entry there has a branch above. Here so adding one to the map and
         forgetting the branch is a refusal rather than a silent undefined. */
      throw new Refused(`"${addonId}" called ${method}, which Gryt does not serve.`);
  }
}

/**
 * Start a plugin in its own worker.
 *
 * `url` is where the addon's entry point is served from — the Vite dev server
 * in development, the app's own local server when packaged. Both are the same
 * origin as the app, which is why the worker can import it directly.
 */
export function startPlugin(
  addonId: string,
  url: string,
  manifestCapabilities: string[] | undefined,
): void {
  stopPlugin(addonId);

  /* The options object has to be a static literal: Vite reads it at build time
     to work out that this is a module worker, and refuses to guess. So no
     `name` with the addon id in it — every line a plugin produces already
     carries its id, which is what the name would have been for. */
  const worker = new Worker(new URL("./addonWorker.ts", import.meta.url), {
    type: "module",
  });

  const entry: Running = {
    worker,
    capabilities: declaredCapabilities(manifestCapabilities),
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
 * Stop one, whether or not it cooperates.
 *
 * It is asked first, so a plugin that cleared a status or a timer gets to. Then
 * it is terminated regardless — a plugin cannot stay running by never finishing
 * its cleanup, which is a thing that could only be promised from out here.
 */
export function stopPlugin(addonId: string): void {
  const entry = running.get(addonId);
  if (!entry) return;
  running.delete(addonId);

  for (const drop of entry.unsubscribes) drop();

  try {
    entry.worker.postMessage({ kind: "stop" } satisfies HostMessage);
  } catch {
    /* Already gone. Terminating below is the whole of what is left to do. */
  }
  setTimeout(() => entry.worker.terminate(), STOP_GRACE_MS);
}

export function stopAllPlugins(): void {
  for (const addonId of [...running.keys()]) stopPlugin(addonId);
}

/** Re-exported so the socket layer keeps one import for inbound messages. */
export { routeMessage as deliverPluginMessage };
