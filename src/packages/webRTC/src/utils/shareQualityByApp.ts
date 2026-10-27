/** The quality last shared per app: by a hash of its icon, or by the window's name where the OS gives no icon (macOS). */
const STORAGE_KEY = "gryt:shareQualityByApp";

function appKey(appIcon: string, name: string): string {
  if (!appIcon) return `name:${name}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < appIcon.length; i++) h = Math.imul(h ^ appIcon.charCodeAt(i), 0x01000193);
  return `icon:${(h >>> 0).toString(36)}`;
}

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function rememberedPreset(appIcon: string, name: string): string | undefined {
  return read()[appKey(appIcon, name)];
}

export function rememberPreset(appIcon: string, name: string, preset: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), [appKey(appIcon, name)]: preset }));
  } catch {
    // Private mode or a full store: the picker just starts on the default next time.
  }
}
