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
  getStartWithWindowsSupported(): Promise<boolean>;
  getStartWithWindows(): Promise<boolean>;
  setStartWithWindows(enabled: boolean): void;
  getStartMinimizedOnLogin(): Promise<boolean>;
  setStartMinimizedOnLogin(enabled: boolean): void;
  getHardwareAcceleration(): Promise<boolean>;
  setHardwareAcceleration(enabled: boolean): void;
  setBadgeCount(count: number): void;
  toggleAlwaysOnTop(pinned: boolean): void;
  getDesktopSources(): Promise<DesktopSource[]>;
  isNativeAudioCaptureAvailable(): Promise<boolean>;
  startNativeAudioCapture(): Promise<boolean>;
  stopNativeAudioCapture(): void;
  onNativeAudioData(callback: (pcm: ArrayBuffer) => void): () => void;
  onNativeAudioStopped(callback: () => void): () => void;
  onWindowFocusChange(callback: (focused: boolean) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  openExternal(url: string): void;
  loadUserData(userId: string): Promise<Record<string, unknown>>;
  saveUserData(userId: string, data: Record<string, unknown>): void;
  setUserData(userId: string, key: string, value: unknown): void;
  onAuthCallback(callback: (url: string) => void): () => void;
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
