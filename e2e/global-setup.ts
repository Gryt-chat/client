import { randomBytes } from "node:crypto";

import { startPreview } from "./support/preview";
import { ensureImage, freePort, removeRunContainersSync } from "./support/server";

export default async function globalSetup() {
  const runId = randomBytes(6).toString("hex");
  process.env.GRYT_E2E_RUN_ID = runId;

  const port = Number(process.env.GRYT_E2E_APP_PORT) || (await freePort());
  const preview = startPreview(port);
  process.env.GRYT_E2E_APP_URL = preview.url;

  const cleanup = () => {
    preview.stop();
    removeRunContainersSync(runId);
  };
  process.once("exit", cleanup);

  try {
    await Promise.all([preview.ready, process.env.GRYT_E2E_SERVER ? Promise.resolve() : ensureImage()]);
  } catch (err) {
    cleanup();
    throw err;
  }

  return async () => {
    cleanup();
    process.removeListener("exit", cleanup);
  };
}
