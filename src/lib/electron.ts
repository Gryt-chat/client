export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  type: "plugin" | "theme";
  description?: string;
  author?: string;
  banner?: string;
  /** Theme-only: CSS files to inject */
  styles?: string[];
  /** Plugin-only: JS entry point */
  main?: string;
}

export interface UpdateStatus {
  status: "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
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

export interface LanServer {
  name: string;
  host: string;
  port: number;
  version: string | null;
}

export interface NativeScreenFrame {
  width: number;
  height: number;
  timestampUs: number;
  data: ArrayBuffer;
}

export interface ElectronAPI {
  isElectron: true;
  getAppVersion(): Promise<string>;
  onPttDown(callback: () => void): () => void;
  onPttUp(callback: () => void): () => void;
  setPttKey(pttKey: string): void;
  checkForUpdates(): void;
  downloadUpdate(): void;
  installUpdate(): void;
  getBetaChannel(): Promise<boolean>;
  setBetaChannel(enabled: boolean): void;
  switchUpdateChannel(enabled: boolean): void;
  getCloseToTray(): Promise<boolean>;
  setCloseToTray(enabled: boolean): void;
  setSignedIn(signedIn: boolean): void;
  getStartWithWindowsSupported(): Promise<boolean>;
  getStartWithWindows(): Promise<boolean>;
  setStartWithWindows(enabled: boolean): void;
  getStartMinimizedOnLogin(): Promise<boolean>;
  setStartMinimizedOnLogin(enabled: boolean): void;
  getHardwareAcceleration(): Promise<boolean>;
  setHardwareAcceleration(enabled: boolean): void;
  setBadgeCount(count: number): void;
  toggleAlwaysOnTop(pinned: boolean, windowTitle?: string): void;
  getScreenCaptureAccess(): Promise<"not-determined" | "granted" | "denied" | "restricted">;
  getDesktopSources(): Promise<DesktopSource[]>;
  isNativeAudioCaptureAvailable(): Promise<boolean>;
  startNativeAudioCapture(sourceId?: string): Promise<boolean>;
  stopNativeAudioCapture(): void;
  onNativeAudioData(callback: (pcm: ArrayBuffer) => void): () => void;
  onNativeAudioStopped(callback: () => void): () => void;
  onNativeAudioDiagnostic(callback: (msg: string) => void): () => void;
  isNativeScreenCaptureAvailable(): Promise<boolean>;
  startNativeScreenCapture(monitorIndex: number, fps: number, maxWidth?: number, maxHeight?: number, bitrate?: number, codec?: string): Promise<{ success: boolean; wsPort?: number }>;
  stopNativeScreenCapture(): void;
  onNativeScreenFrame(callback: (frame: NativeScreenFrame) => void): () => void;
  onNativeScreenCaptureStopped(callback: () => void): () => void;
  onWindowFocusChange(callback: (focused: boolean) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  openExternal(url: string): void;
  loadUserData(userId: string): Promise<Record<string, unknown>>;
  saveUserData(userId: string, data: Record<string, unknown>): void;
  setUserData(userId: string, key: string, value: unknown): void;
  loadGlobalStore(): Promise<Record<string, unknown>>;
  setGlobalData(key: string, value: unknown): void;
  deleteGlobalData(key: string): void;
  saveGlobalStore(data: Record<string, unknown>): void;
  onAuthCallback(callback: (url: string) => void): () => void;
  listAddons(): Promise<AddonManifest[]>;
  openAddonsFolder(): Promise<string>;
  onAddonsChanged(callback: (addons: AddonManifest[]) => void): () => void;
  onLanServerDiscovered(callback: (server: LanServer) => void): () => void;
  onLanServerRemoved(callback: (server: { host: string; port: number }) => void): () => void;
  onDeepLinkInvite(callback: (data: { host: string; code: string }) => void): () => void;
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
