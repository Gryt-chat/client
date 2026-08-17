import { contextBridge, ipcRenderer } from "electron";

type Callback = () => void;

type EmbeddedServerConfigShape = {
  id: string;
  serverName: string;
  serverPort: number;
  sfuPort: number;
  lanDiscoverable: boolean;
  externalHost: string;
  advertisedAddresses: string[];
  customAdvertisedAddresses: string[];
};

type EmbeddedServerState = {
  id: string;
  status: string;
  config: EmbeddedServerConfigShape | null;
  error: string | null;
  serverUrl: string | null;
};

type EmbeddedLogLine = {
  /** The server this came from, or null for the SFU, which is shared. */
  serverId: string | null;
  source: "sfu" | "server" | "worker";
  level: "error" | "warn" | "info" | "debug";
  text: string;
  at: number;
};

// Buffer invite deep links that arrive before React mounts a listener
// (happens when the app is cold-launched via gryt://invite?...).
let bufferedInvite: { host: string; code: string } | null = null;
ipcRenderer.on(
  "deep-link-invite",
  (_event, data: { host: string; code: string }) => {
    bufferedInvite = data;
  }
);

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,

  getAppVersion(): Promise<string> {
    return ipcRenderer.invoke("get-app-version");
  },

  onPttDown(callback: Callback) {
    ipcRenderer.on("ptt-down", callback);
    return () => ipcRenderer.removeListener("ptt-down", callback);
  },

  onPttUp(callback: Callback) {
    ipcRenderer.on("ptt-up", callback);
    return () => ipcRenderer.removeListener("ptt-up", callback);
  },

  setPttKey(pttKey: string) {
    ipcRenderer.send("ptt-set-key", pttKey);
  },

  checkForUpdates() {
    ipcRenderer.send("check-for-updates");
  },

  restartForUpdate() {
    ipcRenderer.send("restart-for-update");
  },

  getBetaChannel(): Promise<boolean> {
    return ipcRenderer.invoke("get-beta-channel");
  },

  setBetaChannel(enabled: boolean) {
    ipcRenderer.send("set-beta-channel", enabled);
  },

  switchUpdateChannel(enabled: boolean) {
    ipcRenderer.send("switch-update-channel", enabled);
  },

  getCloseToTray(): Promise<boolean> {
    return ipcRenderer.invoke("get-close-to-tray");
  },

  setCloseToTray(enabled: boolean) {
    ipcRenderer.send("set-close-to-tray", enabled);
  },

  setSignedIn(signedIn: boolean) {
    ipcRenderer.send("set-signed-in", signedIn);
  },

  setVoiceState(state: {
    inVoice: boolean;
    muted: boolean;
    deafened: boolean;
    serverName: string | null;
  }) {
    ipcRenderer.send("set-voice-state", state);
  },

  onTrayVoiceCommand(
    callback: (command: "toggle-mute" | "toggle-deafen") => void,
  ) {
    const handler = (
      _event: unknown,
      command: "toggle-mute" | "toggle-deafen",
    ) => callback(command);
    ipcRenderer.on("tray-voice-command", handler);
    return () => ipcRenderer.removeListener("tray-voice-command", handler);
  },

  getStartWithWindowsSupported(): Promise<boolean> {
    return ipcRenderer.invoke("get-start-with-windows-supported");
  },

  getStartWithWindows(): Promise<boolean> {
    return ipcRenderer.invoke("get-start-with-windows");
  },

  setStartWithWindows(enabled: boolean) {
    ipcRenderer.send("set-start-with-windows", enabled);
  },

  getStartMinimizedOnLogin(): Promise<boolean> {
    return ipcRenderer.invoke("get-start-minimized-on-login");
  },

  setStartMinimizedOnLogin(enabled: boolean) {
    ipcRenderer.send("set-start-minimized-on-login", enabled);
  },

  getHardwareAcceleration(): Promise<boolean> {
    return ipcRenderer.invoke("get-hardware-acceleration");
  },

  setHardwareAcceleration(enabled: boolean) {
    ipcRenderer.send("set-hardware-acceleration", enabled);
  },

  onUpdateStatus(
    callback: (status: {
      status: string;
      version?: string;
      percent?: number;
      message?: string;
    }) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        status: string;
        version?: string;
        percent?: number;
        message?: string;
      }
    ) => callback(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },

  setBadgeCount(count: number) {
    ipcRenderer.send("set-badge-count", count);
  },

  /**
   * Repaint the native minimise/maximise/close buttons (GRYT-288).
   *
   * Colours rather than a theme name, because only the renderer can say what
   * the theme variables currently evaluate to. Both must be `#rrggbb`; main
   * refuses anything else.
   */
  setTitlebarOverlay(colors: { color: string; symbolColor: string }) {
    ipcRenderer.send("set-titlebar-overlay", colors);
  },

  toggleAlwaysOnTop(pinned: boolean, windowTitle?: string) {
    ipcRenderer.send("toggle-always-on-top", pinned, windowTitle);
  },

  getScreenCaptureAccess(): Promise<string> {
    return ipcRenderer.invoke("get-screen-capture-access");
  },

  getDesktopSources(): Promise<
    Array<{
      id: string;
      name: string;
      thumbnail: string;
      appIcon: string;
      sourceType: "screen" | "window";
      width?: number;
      height?: number;
    }>
  > {
    return ipcRenderer.invoke("get-desktop-sources");
  },

  isNativeAudioCaptureAvailable(): Promise<boolean> {
    return ipcRenderer.invoke("native-audio-capture-available");
  },

  startNativeAudioCapture(sourceId?: string): Promise<boolean> {
    return ipcRenderer.invoke("start-native-audio-capture", sourceId);
  },

  stopNativeAudioCapture() {
    ipcRenderer.send("stop-native-audio-capture");
  },

  onNativeAudioData(callback: (pcm: ArrayBuffer) => void) {
    const handler = (_event: Electron.IpcRendererEvent, data: ArrayBuffer) =>
      callback(data);
    ipcRenderer.on("native-audio-data", handler);
    return () => ipcRenderer.removeListener("native-audio-data", handler);
  },

  onNativeAudioStopped(callback: () => void) {
    const handler = () => callback();
    ipcRenderer.on("native-audio-stopped", handler);
    return () => ipcRenderer.removeListener("native-audio-stopped", handler);
  },

  onNativeAudioDiagnostic(callback: (msg: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, msg: string) =>
      callback(msg);
    ipcRenderer.on("native-audio-diagnostic", handler);
    return () => ipcRenderer.removeListener("native-audio-diagnostic", handler);
  },

  isNativeScreenCaptureAvailable(): Promise<boolean> {
    return ipcRenderer.invoke("native-screen-capture:available");
  },

  startNativeScreenCapture(
    monitorIndex: number,
    fps: number,
    maxWidth?: number,
    maxHeight?: number,
    bitrate?: number,
    codec?: string
  ): Promise<{ success: boolean; wsPort?: number }> {
    return ipcRenderer.invoke(
      "native-screen-capture:start",
      monitorIndex,
      fps,
      maxWidth,
      maxHeight,
      bitrate,
      codec
    );
  },

  stopNativeScreenCapture() {
    ipcRenderer.send("native-screen-capture:stop");
  },

  onNativeScreenFrame(
    callback: (frame: {
      width: number;
      height: number;
      timestampUs: number;
      data: ArrayBuffer;
    }) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      frame: {
        width: number;
        height: number;
        timestampUs: number;
        data: ArrayBuffer;
      }
    ) => callback(frame);
    ipcRenderer.on("native-screen-capture:frame", handler);
    return () =>
      ipcRenderer.removeListener("native-screen-capture:frame", handler);
  },

  onNativeScreenCaptureStopped(callback: () => void) {
    const handler = () => callback();
    ipcRenderer.on("native-screen-capture:stopped", handler);
    return () =>
      ipcRenderer.removeListener("native-screen-capture:stopped", handler);
  },

  onWindowFocusChange(callback: (focused: boolean) => void) {
    const handler = (_event: Electron.IpcRendererEvent, focused: boolean) =>
      callback(focused);
    ipcRenderer.on("window-focus-change", handler);
    return () => ipcRenderer.removeListener("window-focus-change", handler);
  },

  openExternal(url: string) {
    ipcRenderer.send("auth:open-external", url);
  },

  onAuthCallback(callback: (url: string) => void) {
    const handler = (_event: Electron.IpcRendererEvent, url: string) =>
      callback(url);
    ipcRenderer.on("auth-callback", handler);
    return () => ipcRenderer.removeListener("auth-callback", handler);
  },

  loadUserData(userId: string): Promise<Record<string, unknown>> {
    return ipcRenderer.invoke("user-store:load", userId);
  },

  saveUserData(userId: string, data: Record<string, unknown>) {
    ipcRenderer.send("user-store:save", userId, data);
  },

  setUserData(userId: string, key: string, value: unknown) {
    ipcRenderer.send("user-store:set", userId, key, value);
  },

  // ── Secrets at rest (GRYT-256) ────────────────────────────────
  secretsAvailable(): Promise<boolean> {
    return ipcRenderer.invoke("secret:available");
  },

  sealSecret(plain: string): Promise<string> {
    return ipcRenderer.invoke("secret:seal", plain);
  },

  unsealSecret(sealed: string): Promise<string> {
    return ipcRenderer.invoke("secret:unseal", sealed);
  },

  // ── Global file store (backs localStorage) ─────────────────────
  loadGlobalStore(): Promise<Record<string, unknown>> {
    return ipcRenderer.invoke("global-store:load");
  },

  setGlobalData(key: string, value: unknown) {
    ipcRenderer.send("global-store:set", key, value);
  },

  deleteGlobalData(key: string) {
    ipcRenderer.send("global-store:delete", key);
  },

  saveGlobalStore(data: Record<string, unknown>) {
    ipcRenderer.send("global-store:save", data);
  },

  // ── Addons ────────────────────────────────────────────────────
  listAddons(): Promise<
    Array<{
      id: string;
      name: string;
      version: string;
      type: "plugin" | "theme";
      description?: string;
      author?: string;
      banner?: string;
      styles?: string[];
      main?: string;
    }>
  > {
    return ipcRenderer.invoke("addons:list");
  },

  openAddonsFolder(): Promise<string> {
    return ipcRenderer.invoke("addons:open-folder");
  },

  resolveAddonAsset(addonId: string, relativePath: string): Promise<string> {
    return ipcRenderer.invoke("addons:resolve-asset", addonId, relativePath);
  },

  onAddonsChanged(
    callback: (
      addons: Array<{
        id: string;
        name: string;
        version: string;
        type: "plugin" | "theme";
        description?: string;
        author?: string;
        banner?: string;
        styles?: string[];
        main?: string;
      }>
    ) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      addons: Array<{
        id: string;
        name: string;
        version: string;
        type: "plugin" | "theme";
        description?: string;
        author?: string;
        banner?: string;
        styles?: string[];
        main?: string;
      }>
    ) => callback(addons);
    ipcRenderer.on("addons-changed", handler);
    return () => ipcRenderer.removeListener("addons-changed", handler);
  },

  getLanServers(): Promise<unknown[]> {
    return ipcRenderer.invoke("lan:get-servers");
  },
  rescanLanServers(): void {
    ipcRenderer.send("lan:rescan");
  },
  onLanServerDiscovered(
    callback: (server: {
      name: string;
      host: string;
      port: number;
      version: string | null;
    }) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { name: string; host: string; port: number; version: string | null }
    ) => callback(data);
    ipcRenderer.on("lan-server-discovered", handler);
    return () => ipcRenderer.removeListener("lan-server-discovered", handler);
  },

  onLanServerRemoved(
    callback: (server: { host: string; port: number }) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { host: string; port: number }
    ) => callback(data);
    ipcRenderer.on("lan-server-removed", handler);
    return () => ipcRenderer.removeListener("lan-server-removed", handler);
  },

  onDeepLinkInvite(callback: (data: { host: string; code: string }) => void) {
    if (bufferedInvite) {
      const data = bufferedInvite;
      bufferedInvite = null;
      queueMicrotask(() => callback(data));
    }
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { host: string; code: string }
    ) => {
      bufferedInvite = null;
      callback(data);
    };
    ipcRenderer.on("deep-link-invite", handler);
    return () => ipcRenderer.removeListener("deep-link-invite", handler);
  },

  // ── Embedded server ─────────────────────────────────────────────
  isEmbeddedServerAvailable(): Promise<boolean> {
    return ipcRenderer.invoke("embedded-server:available");
  },

  getEmbeddedServerInfo(): Promise<{
    available: boolean;
    hasExisting: boolean;
    lanIp: string;
    servers: EmbeddedServerState[];
  }> {
    return ipcRenderer.invoke("embedded-server:info");
  },

  createEmbeddedServer(
    serverName: string,
    lanDiscoverable: boolean,
    port?: number
  ): Promise<EmbeddedServerState | null> {
    return ipcRenderer.invoke(
      "embedded-server:create",
      serverName,
      lanDiscoverable,
      port
    );
  },

  /** A free port to offer in the create form. */
  suggestEmbeddedServerPort(): Promise<number> {
    return ipcRenderer.invoke("embedded-server:suggest-port");
  },

  /** Whether a port somebody typed can actually be bound. */
  checkEmbeddedServerPort(port: number): Promise<boolean> {
    return ipcRenderer.invoke("embedded-server:check-port", port);
  },

  startEmbeddedServer(id: string): Promise<EmbeddedServerState | null> {
    return ipcRenderer.invoke("embedded-server:start", id);
  },

  stopEmbeddedServer(id: string): Promise<EmbeddedServerState | null> {
    return ipcRenderer.invoke("embedded-server:stop", id);
  },

  dismissEmbeddedServerError(
    id: string
  ): Promise<EmbeddedServerState | null> {
    return ipcRenderer.invoke("embedded-server:dismiss-error", id);
  },

  /** Stop a server and delete its files. There is no undo. */
  deleteEmbeddedServer(id: string): Promise<EmbeddedServerState[]> {
    return ipcRenderer.invoke("embedded-server:delete", id);
  },

  /** Every server this machine has, running or not. */
  getEmbeddedServerStatus(): Promise<EmbeddedServerState[]> {
    return ipcRenderer.invoke("embedded-server:status");
  },

  updateEmbeddedServerAdvertisedAddresses(
    id: string,
    addresses: string[]
  ): Promise<EmbeddedServerState | null> {
    return ipcRenderer.invoke(
      "embedded-server:update-advertised-addresses",
      id,
      addresses
    );
  },

  onEmbeddedServerStatusChanged(
    callback: (states: EmbeddedServerState[]) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: EmbeddedServerState[]
    ) => callback(data);
    ipcRenderer.on("embedded-server:status-changed", handler);
    return () =>
      ipcRenderer.removeListener("embedded-server:status-changed", handler);
  },

  /** One server's history, plus the shared SFU's. */
  getEmbeddedServerLogs(id?: string): Promise<EmbeddedLogLine[]> {
    return ipcRenderer.invoke("embedded-server:logs", id);
  },

  clearEmbeddedServerLogs(id?: string): Promise<void> {
    return ipcRenderer.invoke("embedded-server:clear-logs", id);
  },

  onEmbeddedServerLog(
    callback: (log: {
      source: string;
      data: string;
      lines?: EmbeddedLogLine[];
    }) => void
  ) {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { source: string; data: string; lines?: EmbeddedLogLine[] }
    ) => callback(data);
    ipcRenderer.on("embedded-server:log", handler);
    return () => ipcRenderer.removeListener("embedded-server:log", handler);
  },

  getEmbeddedServerAutoStart(id: string): Promise<boolean> {
    return ipcRenderer.invoke("embedded-server:get-auto-start", id);
  },

  setEmbeddedServerAutoStart(id: string, enabled: boolean) {
    ipcRenderer.send("embedded-server:set-auto-start", id, enabled);
  },
});
