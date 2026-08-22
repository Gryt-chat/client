import { signReport } from "./assertion";
import { reportsConfig } from "./config";
import type { Report } from "./report";

/**
 * Sending a report to `Gryt-chat/reports`.
 *
 * `POST /v1/reports`, `202` with `{ id, receivedAt }`. The body is serialised
 * once and both signed and posted, which is not a tidiness point: the assertion
 * binds itself to the exact bytes through `bh`, and re-serialising between
 * signing and posting is a signature over a different body.
 */

export interface Submitted {
  id: string;
  receivedAt: string;
}

/**
 * A failure worth telling somebody about, in words rather than a code.
 *
 * The split that matters is whose problem it is. Rate limited and too long are
 * things the reporter can act on; a refused signature is the app's fault and
 * there is nothing useful to say beyond that it did not send.
 */
export class SubmitError extends Error {
  constructor(
    message: string,
    /** True where trying the same thing again might work. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SubmitError";
  }
}

/** How long to wait before giving up on a report nobody is watching. */
const TIMEOUT_MS = 15_000;

export async function submitReport(report: Report): Promise<Submitted> {
  const config = reportsConfig();

  /* Serialised once. Everything below uses these exact bytes. */
  const body = JSON.stringify(report);
  const assertion = await signReport(body);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-gryt-app": config.app,
  };
  if (assertion) headers["x-gryt-identity"] = assertion;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${config.url}/v1/reports`, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
  } catch {
    /* A network-layer failure gives "Failed to fetch", which describes the call
     * rather than the situation. */
    throw new SubmitError(
      "That did not send. Check your connection and try again.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 202) {
    const received = (await response.json().catch(() => null)) as Submitted | null;
    /* The id is for us, not for them, so a reply this app cannot parse is still
     * a report that landed — the service already has it, and saying otherwise
     * would invite a second copy. */
    return received ?? { id: "", receivedAt: new Date().toISOString() };
  }

  throw explain(response);
}

function explain(response: Response): SubmitError {
  if (response.status === 429) {
    const wait = retryAfter(response.headers.get("retry-after"));
    return new SubmitError(
      wait
        ? `That is a lot of reports at once. Try again in ${wait}.`
        : "That is a lot of reports at once. Try again shortly.",
      true,
    );
  }

  if (response.status === 413) {
    return new SubmitError("That is too long to send. Try trimming it down.", false);
  }

  if (response.status === 403) {
    /* The service deliberately says nothing about which identifier is banned,
     * and neither does this. */
    return new SubmitError("Reports are not being accepted from this app.", false);
  }

  /* 400, 401, and anything else. All of them mean this app got something
   * wrong — an empty message the form should have caught, a key that does not
   * match, a signature the service refused — and none of them are actionable by
   * the person who just typed a paragraph. */
  return new SubmitError("That did not send. Something on our side.", true);
}

/** `Retry-After` is seconds or a date. Either way somebody wants a duration. */
function retryAfter(header: string | null): string | null {
  if (!header) return null;

  const seconds = Number(header);
  const remaining = Number.isFinite(seconds)
    ? seconds
    : Math.round((Date.parse(header) - Date.now()) / 1000);

  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  if (remaining < 90) return `${Math.max(1, Math.round(remaining))} seconds`;
  return `${Math.round(remaining / 60)} minutes`;
}
