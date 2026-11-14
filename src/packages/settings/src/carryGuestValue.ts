/* eslint-disable @typescript-eslint/ban-types -- stored JSON from disk, checked before use */

/** A guest value moving onto an account: undefined keeps the account's, and servers merge so none are lost. */
export function carryGuestValue(key: string, account: unknown, guest: unknown): unknown {
  if (account === undefined) return guest;
  if (key === "servers" && isRecord(account) && isRecord(guest)) {
    const added = Object.keys(guest).filter((host) => !(host in account));
    return added.length ? { ...guest, ...account } : undefined;
  }
  if (key === "serverOrder" && Array.isArray(account) && Array.isArray(guest)) {
    const added = guest.filter((host) => !account.includes(host));
    return added.length ? [...account, ...added] : undefined;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
