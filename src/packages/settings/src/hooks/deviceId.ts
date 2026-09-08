/**
 * A stable id for this installation, namespacing settings for somebody who has
 * not signed in. The `device:` prefix cannot collide with a Keycloak sub.
 */

const DEVICE_ID_KEY = "gryt.deviceId";
const DEVICE_PREFIX = "device:";

/**
 * Generated once and kept. Callers can treat this as always returning the same
 * string for the lifetime of the installation.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const id = `${DEVICE_PREFIX}${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // Storage disabled, or a private window. Settings will not outlive the
    // session, which is where this started rather than a new way to fail.
    return `${DEVICE_PREFIX}ephemeral`;
  }
}

export function isDeviceId(id: string): boolean {
  return id.startsWith(DEVICE_PREFIX);
}
