import { AddonManifest } from "@/addons";

export interface UpdateStatus {
  status:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    // An install has already been handed to the installer and is still going.
    // Checking again would start a second update cycle, which destroys the
    // first — so this is reported instead of a new check.
    | "pending"
    | "error";
  version?: string;
  percent?: number;
  message?: string;
}

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  appIcon: string;
  sourceType: "screen" | "window";
  width?: number;
  height?: number;
}

export type TrayVoiceState = {
  inVoice: boolean;
  muted: boolean;
  deafened: boolean;
  /** For the tray menu's header and the tooltip. */
  serverName: string | null;
};

export type TrayVoiceCommand = "toggle-mute" | "toggle-deafen";

export type EmbeddedLogSource = "sfu" | "server" | "worker";

export type EmbeddedLogLine = {
  /** The server this came from, or null for the SFU, which every server shares. */
  serverId: string | null;
  source: EmbeddedLogSource;
  level: "error" | "warn" | "info" | "debug";
  text: string;
  /** Epoch millis, stamped in the main process when the line arrived. */
  at: number;
};

export type LanServer = {
  host: string;
  port: number;
  name: string;
  version?: string;
  serverId?: string;
};

export interface NativeScreenFrame {
  width: number;
  height: number;
  timestampUs: number;
  data: ArrayBuffer;
}

export interface EmbeddedServerConfig {
  /** Stable handle for this server, and the name of its directory on disk. */
  id: string;
  serverName: string;
  serverPort: number;
  sfuPort: number;
  lanDiscoverable: boolean;
  externalHost: string;
}

export interface EmbeddedServerState {
  id: string;
  status: string;
  config: EmbeddedServerConfig | null;
  error: string | null;
  serverUrl: string | null;
}

export interface EmbeddedServerInfo {
  available: boolean;
  hasExisting: boolean;
  lanIp: string;
  servers: EmbeddedServerState[];
}

export interface ElectronAPI {
  isElectron: true;
  getAppVersion(): Promise<string>;
  onPttDown(callback: () => void): () => void;
  onPttUp(callback: () => void): () => void;
  setPttKey(pttKey: string): void;
  checkForUpdates(): void;
  /** Quit and come back, letting the splash download and install. */
  restartForUpdate(): void;
  getBetaChannel(): Promise<boolean>;
  setBetaChannel(enabled: boolean): void;
  switchUpdateChannel(enabled: boolean): void;
  getCloseToTray(): Promise<boolean>;
  setCloseToTray(enabled: boolean): void;
  setSignedIn(signedIn: boolean): void;
  /**
   * Tell the tray what voice is doing.
   *
   * The main process has no other route to any of this — mute and deafen are
   * renderer settings and the SFU connection is a renderer concern.
   */
  setVoiceState(state: TrayVoiceState): void;
  /** Mute and deafen, driven from the tray menu. Returns an unsubscribe. */
  onTrayVoiceCommand(
    callback: (command: TrayVoiceCommand) => void,
  ): () => void;
  getStartWithWindowsSupported(): Promise<boolean>;
  getStartWithWindows(): Promise<boolean>;
  setStartWithWindows(enabled: boolean): void;
  getStartMinimizedOnLogin(): Promise<boolean>;
  setStartMinimizedOnLogin(enabled: boolean): void;
  getHardwareAcceleration(): Promise<boolean>;
  setHardwareAcceleration(enabled: boolean): void;
  setBadgeCount(count: number): void;
  toggleAlwaysOnTop(pinned: boolean, windowTitle?: string): void;
  getScreenCaptureAccess(): Promise<
    "not-determined" | "granted" | "denied" | "restricted"
  >;
  getDesktopSources(): Promise<DesktopSource[]>;
  isNativeAudioCaptureAvailable(): Promise<boolean>;
  startNativeAudioCapture(sourceId?: string): Promise<boolean>;
  stopNativeAudioCapture(): void;
  onNativeAudioData(callback: (pcm: ArrayBuffer) => void): () => void;
  onNativeAudioStopped(callback: () => void): () => void;
  onNativeAudioDiagnostic(callback: (msg: string) => void): () => void;
  isNativeScreenCaptureAvailable(): Promise<boolean>;
  startNativeScreenCapture(
    monitorIndex: number,
    fps: number,
    maxWidth?: number,
    maxHeight?: number,
    bitrate?: number,
    codec?: string
  ): Promise<{ success: boolean; wsPort?: number }>;
  stopNativeScreenCapture(): void;
  onNativeScreenFrame(callback: (frame: NativeScreenFrame) => void): () => void;
  onNativeScreenCaptureStopped(callback: () => void): () => void;
  onWindowFocusChange(callback: (focused: boolean) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  openExternal(url: string): void;
  loadUserData(userId: string): Promise<Record<string, unknown>>;
  saveUserData(userId: string, data: Record<string, unknown>): void;
  setUserData(userId: string, key: string, value: unknown): void;
  /**
   * Encrypt and decrypt with the OS keychain (GRYT-256).
   *
   * Not a store — the sealed blob stays wherever the caller already keeps it.
   * The OS holds the key and ties it to the user's login, so this protects
   * something at rest without asking for a password. Desktop only; the web
   * client has no equivalent.
   *
   * `secretsAvailable` is false on a Linux box with no keyring, which plenty of
   * self-hosters will be, so every caller needs a path for that.
   */
  secretsAvailable(): Promise<boolean>;
  sealSecret(plain: string): Promise<string>;
  unsealSecret(sealed: string): Promise<string>;
  loadGlobalStore(): Promise<Record<string, unknown>>;
  setGlobalData(key: string, value: unknown): void;
  deleteGlobalData(key: string): void;
  saveGlobalStore(data: Record<string, unknown>): void;
  onAuthCallback(callback: (url: string) => void): () => void;
  listAddons(): Promise<AddonManifest[]>;
  openAddonsFolder(): Promise<string>;
  resolveAddonAsset(addonId: string, relativePath: string): Promise<string>;
  onAddonsChanged(callback: (addons: AddonManifest[]) => void): () => void;
  /** Servers already discovered, for a renderer that mounted after the fact. */
  getLanServers(): Promise<LanServer[]>;
  /** Restart the browse so everything on the network re-announces itself. */
  rescanLanServers(): void;
  onLanServerDiscovered(callback: (server: LanServer) => void): () => void;
  onLanServerRemoved(
    callback: (server: { host: string; port: number }) => void
  ): () => void;
  onDeepLinkInvite(
    callback: (data: { host: string; code: string }) => void
  ): () => void;
  isEmbeddedServerAvailable(): Promise<boolean>;
  getEmbeddedServerInfo(): Promise<EmbeddedServerInfo>;
  createEmbeddedServer(
    serverName: string,
    lanDiscoverable: boolean,
    port?: number
  ): Promise<EmbeddedServerState | null>;
  suggestEmbeddedServerPort(): Promise<number>;
  checkEmbeddedServerPort(port: number): Promise<boolean>;
  startEmbeddedServer(id: string): Promise<EmbeddedServerState | null>;
  stopEmbeddedServer(id: string): Promise<EmbeddedServerState | null>;
  dismissEmbeddedServerError(id: string): Promise<EmbeddedServerState | null>;
  deleteEmbeddedServer(id: string): Promise<EmbeddedServerState[]>;
  getEmbeddedServerStatus(): Promise<EmbeddedServerState[]>;
  onEmbeddedServerStatusChanged(
    callback: (states: EmbeddedServerState[]) => void
  ): () => void;
  onEmbeddedServerLog(
    callback: (log: {
      source: string;
      data: string;
      lines?: EmbeddedLogLine[];
    }) => void
  ): () => void;
  /** Everything retained so far, so an opening pane is not blank. */
  getEmbeddedServerLogs(id?: string): Promise<EmbeddedLogLine[]>;
  clearEmbeddedServerLogs(id?: string): Promise<void>;
  getEmbeddedServerAutoStart(id: string): Promise<boolean>;
  setEmbeddedServerAutoStart(id: string, enabled: boolean): void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function isElectron(): boolean {
  return !!window.electronAPI?.isElectron;
}

export function getElectronAPI(): ElectronAPI | null {
  return window.electronAPI ?? null;
}
