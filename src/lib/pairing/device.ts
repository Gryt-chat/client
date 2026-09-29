import type { PairingDeviceInfo } from "@gryt/core";

/* What the new device says about itself on the other device's approval screen. It's a
   claim the other side shows as such, so a best guess from the user agent is enough. */

function osOf(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return "an unknown system";
}

function browserOf(ua: string): string {
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "A browser";
}

const COMPUTER: Record<string, string> = { macOS: "Mac", Windows: "Windows PC", Linux: "Linux PC", ChromeOS: "Chromebook" };

export function describeThisDevice(userAgent: string, desktop: boolean): PairingDeviceInfo {
  const platform = osOf(userAgent);
  return desktop
    ? { name: COMPUTER[platform] ?? "Computer", app: "Gryt desktop", platform }
    : { name: browserOf(userAgent), app: "Gryt in a browser", platform };
}
