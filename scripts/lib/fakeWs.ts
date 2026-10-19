import type { Server as HttpServer } from "node:http";
import { createRequire } from "node:module";

export type FakeWs = { send(data: string): void; on(event: "close" | "message", listener: (data: Buffer) => void): void; terminate(): void };
export type FakeWss = { on(event: "connection", listener: (ws: FakeWs) => void): void; clients: Set<FakeWs>; close(done: () => void): void };

// engine.io-client's own ws, which ships no types, so only what the checks use.
const require = createRequire(import.meta.url);
export const { WebSocketServer } = createRequire(require.resolve("engine.io-client"))("ws") as {
  WebSocketServer: new (options: { server: HttpServer }) => FakeWss;
};
