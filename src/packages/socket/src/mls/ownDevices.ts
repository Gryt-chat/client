import type { MlsOwnDevice } from "@gryt/core";

/* The device list's wording and order. The phone has the same in src/mls/ownDevices.ts. */

/** This device first, then the rest oldest first, as the server lists them. */
export function orderOwnDevices(devices: readonly MlsOwnDevice[]): MlsOwnDevice[] {
  return [...devices.filter((d) => d.thisDevice), ...devices.filter((d) => !d.thisDevice)];
}

/** A device that's in none of your DMs with this one yet has no certificate here to name it. */
export function ownDeviceLabel(device: MlsOwnDevice): string {
  return device.name ?? "Another device";
}

export function ownDeviceAdded(device: MlsOwnDevice): string | null {
  const at = device.addedAt ? new Date(device.addedAt) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  return `Added ${at.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
}

/* True because the server refuses that device id from now on, and the app on it wipes
   that server's history when it hears so (GRYT-1555). */
export function removeOwnDeviceWarning(device: MlsOwnDevice, serverName: string): string {
  const which = device.name ? `“${device.name}”` : "That device";
  return `${which} won't get new encrypted DMs on ${serverName} anymore. The next time it connects, it deletes the encrypted DMs it has from there.`;
}

/** What a removed device says, wherever it would have shown DMs from that server. */
export function removedHereLine(home: "browser" | "app", how: "sign_in" | "recovery_key"): string {
  const here = home === "browser" ? "This browser" : "This device";
  const again =
    how === "sign_in" ? "To set it up again, sign out and sign back in." : "To set it up again, restore your identity from its recovery key.";
  return `${here} was removed from encrypted DMs on this server. ${again}`;
}
