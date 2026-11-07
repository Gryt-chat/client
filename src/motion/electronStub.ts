import { agreementAt, TERMS_STORAGE_KEY } from "@gryt/core";

// The first message waits on a terms prompt otherwise, and the reply never posts.
localStorage.setItem(TERMS_STORAGE_KEY, JSON.stringify(agreementAt(new Date())));
// The desktop app's embedded-server bridge, answered locally so the real Create server panel runs.
// No isElectron flag: nothing else in the page should take this for the desktop app.
const servers: { id: string; config: { serverName: string } }[] = [];

const known: Record<string, unknown> = {
  getEmbeddedServerInfo: async () => ({ available: true, lanIp: "192.168.1.20", servers, bundled: undefined }),
  suggestEmbeddedServerPort: async () => 5001,
  checkEmbeddedServerPort: async () => true,
  getEmbeddedServerAutoStart: async () => true,
  onEmbeddedServerStatusChanged: () => () => {},
  // A closed port, so nothing in the page reaches a real server on this machine.
  createEmbeddedServer: async (serverName: string) => {
    window.dispatchEvent(new CustomEvent("motion:server-created", { detail: serverName }));
    return { serverUrl: "http://127.0.0.1:9", config: { serverName } };
  },
};

// Anything else the hooks ask for: subscriptions return an unsubscribe, lists come back empty.
(window as unknown as { electronAPI: unknown }).electronAPI = new Proxy(known, {
  get(target, key) {
    if (typeof key !== "string" || key === "then" || key === "isElectron") return undefined;
    if (key in target) return target[key];
    if (/^on[A-Z]/.test(key)) return () => () => {};
    return async () => (/^get.*s$/.test(key) ? [] : undefined);
  },
});
