import type { ChannelName } from "./mentionTokens.ts";

/* The channel names each server sent this client, for text read outside React.
   A server only names channels the member can see, which is what #private-channel needs. */
let byHost = new Map<string, Map<string, string>>();

export function rememberChannelNames(host: string, channels: readonly { id?: string; name?: string }[]): void {
  const names = new Map<string, string>();
  for (const c of channels) if (c?.id && c.name) names.set(c.id, c.name);
  byHost = new Map(byHost).set(host, names);
}

/** Resolves a channel mention read on `host`. A link naming another server looks there. */
export function channelNamesFor(host: string): ChannelName {
  return (id, target) => byHost.get(target ?? host)?.get(id) ?? null;
}

/** Asks the app to open a channel, on this server or another one it is in. */
export const OPEN_CHANNEL_EVENT = "gryt:channel-link-open";

export function openChannelLink(host: string, channelId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_CHANNEL_EVENT, { detail: { host, channelId } }));
}
