/**
 * The seed a person's avatar is drawn from.
 *
 * Its own file, small as it is, because two apps have to agree on it exactly.
 * The web client and the mobile app both draw the same owl from the same
 * nickname, and the only way that holds is if neither of them re-derives this
 * rule. `generatedAvatar.ts` re-exports it, so nothing outside has to know it
 * moved.
 */

/**
 * Their nickname, normalised.
 *
 * Case and surrounding whitespace are dropped so "Sivert" and " sivert " are
 * one person. Everything else is kept — two nicknames that differ at all are
 * two owls.
 *
 * The nickname rather than the per-server id, which is what this used first.
 * The id gave a stable avatar across a rename, but it is issued per server, so
 * the same person arrived in every server looking like somebody else — nothing
 * about them had changed and yet they were unrecognisable. Nicknames travel.
 *
 * Two costs, deliberately accepted: two people using one nickname share an owl,
 * and renaming yourself changes yours.
 */
export function avatarSeed(nickname: string | null | undefined): string | undefined {
  const trimmed = nickname?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}
