// No imports, so scripts/check-notification-navigation.mjs can run this as it is.

/** As much of a channel as choosing one to show needs. */
export interface SelectableChannel {
  id: string;
  type: string;
}

/** The channel on screen, and the server it was picked on. */
export interface ChannelSelection {
  host: string | null;
  channelId: string | null;
}

export const NO_CHANNEL: ChannelSelection = { host: null, channelId: null };

/**
 * The channel to show on `host`, decided in one step. A pick made on another server
 * never counts here, so arriving starts from the saved channel, which a notification sets.
 */
export function selectChannel(
  current: ChannelSelection,
  host: string | null,
  channels: readonly SelectableChannel[] | undefined,
  saved: string | null,
): ChannelSelection {
  if (!host) return current.host === null && current.channelId === null ? current : NO_CHANNEL;

  const picked = current.host === host ? current.channelId : null;
  const firstText = channels?.find((c) => c.type === "text");
  let next: string | null;
  if (!channels) {
    // Nothing to check against until the server's channels arrive.
    next = picked;
  } else if (picked) {
    // Kept while it exists. A deleted one falls back like it always did.
    next = channels.some((c) => c.id === picked) ? picked : (firstText ?? channels[0])?.id ?? null;
  } else {
    const restored = saved ? channels.find((c) => c.id === saved && c.type !== "voice") : undefined;
    next = (restored ?? firstText)?.id ?? null;
  }

  return current.host === host && current.channelId === next ? current : { host, channelId: next };
}
