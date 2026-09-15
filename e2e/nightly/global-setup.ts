import { startPreview } from "../support/preview";

/** A fixed port, because the test server's CORS list names its origins one by one and 4173 is on it. */
const APP_PORT = Number(process.env.GRYT_E2E_APP_PORT) || 4173;

export default async function globalSetup() {
  const preview = startPreview(APP_PORT);
  process.env.GRYT_E2E_APP_URL = preview.url;
  process.once("exit", preview.stop);

  try {
    await preview.ready;
  } catch (err) {
    preview.stop();
    throw err;
  }

  return async () => {
    preview.stop();
    process.removeListener("exit", preview.stop);
  };
}
