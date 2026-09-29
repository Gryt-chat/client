/**
 * A game's Rich Presence card, as the server checks and sends it (`richActivity`
 * on a member). The server drops every other field, so a card never draws one.
 */
export interface RichActivity {
  type: "playing" | "listening" | "watching" | "competing";
  /** Always there. A card with no name isn't sent at all. */
  name: string;
  details?: string;
  state?: string;
  /** Epoch milliseconds. The card counts up from it. */
  startedAt?: number;
  party?: { size: number; max?: number };
  /** Two at most, each an http or https link to a public host. */
  buttons?: { label: string; url: string }[];
  /** The game's Discord application id, checked as a snowflake. For an icon. */
  appId?: string;
}
