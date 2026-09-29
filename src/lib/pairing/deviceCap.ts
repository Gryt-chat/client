/* The server allows five MLS devices per person (`too_many_devices`). A sixth isn't added to
   that server's DMs, so the approving side says so before Approve (GRYT-1582). */

export const MAX_DEVICES_PER_SERVER = 5;

/** Servers where the new device would be one too many, in the order given. */
export function serversAtDeviceCap<T extends { deviceCount: number | null }>(servers: readonly T[]): T[] {
  return servers.filter((s) => s.deviceCount !== null && s.deviceCount >= MAX_DEVICES_PER_SERVER);
}

export function deviceCapLine(serverName: string): string {
  return `${serverName} already has ${MAX_DEVICES_PER_SERVER} of your devices, so the new one won't get your DMs there. Remove one first.`;
}
