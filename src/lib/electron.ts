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
  installUpdate(): void;
  getBetaChannel(): Promise<boolean>;
  setBetaChannel(enabled: boolean): void;
  getCloseToTray(): Promise<boolean>;
  setCloseToTray(enabled: boolean): void;
  setBadgeCount(count: number): void;
  toggleAlwaysOnTop(pinned: boolean): void;
  getDesktopSources(): Promise<DesktopSource[]>;
  onWindowFocusChange(callback: (focused: boolean) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  openExternal(url: string): void;
  onAuthCallback(callback: (url: string) => void): () => void;
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
