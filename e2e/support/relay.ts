import { type PairingRelay, PairingRelayError } from "@gryt/core";
import { base64Url, base64UrlDecode } from "@gryt/crypto";
import type { BrowserContext, Route } from "@playwright/test";

import { memoryRelay } from "../../scripts/pairing-fakes";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, DELETE",
};

/** The pairing relay's HTTP API on id.gryt.chat, answered from one relay in this process. */
export async function routeRelay(contexts: BrowserContext[], relay: PairingRelay = memoryRelay()): Promise<void> {
  const handle = async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const url = new URL(req.url());
    const [id, kind, n] = url.pathname.replace("/api/v1/pairing/sessions", "").split("/").filter(Boolean).map(decodeURIComponent);
    const token = (req.headers().authorization ?? "").replace(/^Bearer /, "");
    const raw = req.postData();
    const body = raw ? JSON.parse(raw) : undefined;
    const reply = (status: number, json?: unknown) =>
      route.fulfill({ status, headers: CORS, contentType: "application/json", body: json === undefined ? undefined : JSON.stringify(json) });
    try {
      const m = req.method();
      if (!id && m === "POST") return reply(200, await relay.create(body.commit));
      if (id === "claim") {
        const { pkA, ...by } = body;
        return reply(200, await relay.claim(by, pkA));
      }
      if (kind === "messages" && m === "POST") return reply(204, await relay.post(id, token, body));
      if (kind === "messages") {
        const after = Number(url.searchParams.get("after") ?? 0);
        return reply(200, { messages: await relay.poll(id, token, after, Number(url.searchParams.get("wait") ?? 0)) });
      }
      if (kind === "chunks" && m === "PUT") return reply(204, await relay.putChunk(id, token, Number(n), base64UrlDecode(body.body)));
      if (kind === "chunks" && m === "GET") return reply(200, { body: base64Url(await relay.getChunk(id, token, Number(n))) });
      if (kind === "chunks") return reply(204, await relay.deleteChunk(id, token, Number(n)));
      if (m === "DELETE") return reply(204, await relay.close(id, token));
      return reply(404, { error: "unknown_route" });
    } catch (e) {
      if (e instanceof PairingRelayError) return reply(e.status, { error: e.code });
      throw e;
    }
  };
  for (const context of contexts) await context.route("https://id.gryt.chat/api/v1/pairing/**", handle);
}
