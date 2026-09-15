import { isPrivateAddress } from "./webrtc";

export interface TestServer {
  /** As the app stores it, e.g. `test.gryt.chat`. */
  host: string;
  httpBase: string;
  /** An invite link, the way somebody would paste one. */
  invite: string;
  /** On this machine or a LAN, so its SFU has no public address to look for. */
  private: boolean;
}

export function testServer(): TestServer {
  const url = process.env.GRYT_TEST_SERVER_URL;
  const code = process.env.GRYT_TEST_INVITE_CODE;
  if (!url || !code) {
    throw new Error("Set GRYT_TEST_SERVER_URL and GRYT_TEST_INVITE_CODE. The nightly section of e2e/README.md has both.");
  }

  const { host, hostname, origin } = new URL(url);
  const query = new URLSearchParams({ host, code });
  return {
    host,
    httpBase: origin,
    invite: `https://app.gryt.chat/invite?${query}`,
    private: hostname === "localhost" || isPrivateAddress(hostname),
  };
}
