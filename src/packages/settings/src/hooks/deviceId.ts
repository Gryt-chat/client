/**
 * A stable id for this installation, used to namespace settings for somebody
 * who has not signed in.
 *
 * Settings are stored under `user:<id>:<key>`, and until now that id came only
 * from Keycloak. Signed out, it was null, and every write was dropped on the
 * floor — which was survivable while an account was the only way in, and stopped
 * being survivable the moment guest-by-default (GRYT-173) made signed-out the
 * normal first run. Nickname, audio devices, volumes, pinned sidebars, the
 * server list and hasSeenWelcome all evaporated on reload (GRYT-181).
 *
 * The `device:` prefix keeps this in a namespace an account id can never reach:
 * a Keycloak sub is a bare UUID, so the two cannot collide, and the tier can be
 * read off any stored id without a schema change. That is the same trick the
 * identity work uses for its `key:` prefix.
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
