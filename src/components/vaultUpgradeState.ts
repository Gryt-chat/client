/**
 * The one-time prompt to move an old message backup to Argon2id: who sees it, what
 * dismissing it remembers, and which call each answer makes (GRYT-1498).
 */
import { type SealedVault, vaultNeedsUpgrade } from "../packages/common/src/auth/identity-vault.ts";
import { MIN_VAULT_PASSWORD } from "../packages/common/src/auth/message-password.ts";
import type { ResealOutcome, UpgradeOutcome } from "../packages/common/src/auth/message-vault-upgrade.ts";

const PREFIX = "gryt_vault_upgrade_dismissed:";

/** Per account, so a second account on this device still gets asked. */
export function upgradePromptDismissed(grytUserId: string): boolean {
  try {
    return localStorage.getItem(`${PREFIX}${grytUserId}`) === "1";
  } catch {
    // Unreadable storage asks again. The settings notice is there either way.
    return false;
  }
}

export function dismissUpgradePrompt(grytUserId: string): void {
  try {
    localStorage.setItem(`${PREFIX}${grytUserId}`, "1");
  } catch {
    // Nothing to do. The cost is being asked once more next launch.
  }
}

export interface UpgradePromptInput {
  /** The signed-in account, or null for a guest or while it is still loading. */
  grytUserId: string | null;
  keyIsHere: boolean;
  /** undefined while loading, null when the account has no backup at all. */
  vault: SealedVault | null | undefined;
}

/** Guests never get this: they have no backup, and the words are in their own section. */
export function shouldPromptUpgrade({ grytUserId, keyIsHere, vault }: UpgradePromptInput): boolean {
  if (!grytUserId || !keyIsHere || !vault) return false;
  if (!vaultNeedsUpgrade(vault)) return false;
  return !upgradePromptDismissed(grytUserId);
}

/** Characters, as `describePasswordProblem` counts them, so an emoji is one. */
export function passwordIsShort(secret: string): boolean {
  return [...secret].length < MIN_VAULT_PASSWORD;
}

/** The account calls, injected so the check script can run them against a fake store. */
export interface UpgradeCalls {
  upgrade(vault: SealedVault, secret: string): Promise<UpgradeOutcome>;
  reseal(vault: SealedVault, password: string, recoveryKey?: Uint8Array): Promise<ResealOutcome>;
  read(): Promise<SealedVault | null>;
}

export type UpgradeStep =
  | { kind: "done" }
  /** Upgraded, but under a password below the floor. `vault` is what the account holds now. */
  | { kind: "short"; vault: SealedVault }
  | { kind: "changed" }
  | { kind: "restored" };

/** Throws on a wrong password, with nothing written. */
export async function upgradeWithPassword(
  vault: SealedVault,
  secret: string,
  calls: UpgradeCalls,
): Promise<UpgradeStep> {
  const outcome = await calls.upgrade(vault, secret);
  if (outcome === "changed" || outcome === "restored") return { kind: outcome };

  // The upgrade keeps the password, so a four-character one is still four characters.
  if (passwordIsShort(secret)) {
    const now = await calls.read().catch(() => null);
    if (now) return { kind: "short", vault: now };
  }
  return { kind: "done" };
}

/** A new password from this device's own key, for a short one or a forgotten one. */
export function chooseNewPassword(
  vault: SealedVault,
  { password, recoveryKey }: { password: string; recoveryKey?: Uint8Array },
  calls: UpgradeCalls,
): Promise<ResealOutcome> {
  return calls.reseal(vault, password, recoveryKey);
}
