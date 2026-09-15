export interface ClaimOutcomeToast {
  tone: "success" | "info" | "error";
  message: string;
}

/** What the server did with a yes, from `identityClaim` on `server:joined`. Null
    for a server too old to say, which then says nothing. */
export function claimOutcomeToast(outcome: unknown): ClaimOutcomeToast | null {
  switch (outcome) {
    case "carried":
      return { tone: "success", message: "Moved the guest to your account." };
    case "merged":
      return {
        tone: "success",
        message: "Moved your guest messages to your account. Your account keeps its name, picture and roles.",
      };
    case "no_prior_membership":
      return { tone: "info", message: "This server doesn't have a guest from this device, so nothing moved." };
    case "failed":
      return { tone: "error", message: "The server couldn't move the guest to your account." };
    default:
      return null;
  }
}

/** A join answers well inside this. Past it the join was refused, and a later one
    must not be read as the answer to this yes. */
export const CLAIM_OUTCOME_WAIT_MS = 20_000;

const awaiting = new Map<string, number>();

/** Every rejoin reports the stored yes again, so only the one right after the
    click is worth a toast. */
export function expectClaimOutcome(host: string, now = Date.now()): void {
  awaiting.set(host, now + CLAIM_OUTCOME_WAIT_MS);
}

export function takeClaimOutcome(host: string, now = Date.now()): boolean {
  const until = awaiting.get(host);
  awaiting.delete(host);
  return until !== undefined && now <= until;
}
