/**
 * How a key's history and a key's change are put into words (GRYT-728).
 *
 * Separate from the card because this is the part that can be wrong without
 * looking wrong: a boundary off by one says "same key for 0 days", and a
 * sentence that picks a cause tells somebody their peer got a new phone when a
 * server swapped a key. `check-member-key-wording.mjs` walks the boundaries.
 */

/**
 * When a key was pinned, in words rather than a date nobody reads. How long is
 * the whole of it: a key seen once yesterday and a key seen every day for a
 * year both verify, and only one of them is worth much.
 */
export function describePin(firstSeenAt: number): string {
  const days = Math.floor((Date.now() - firstSeenAt) / 86_400_000);
  if (days < 1) return "Same key since today";
  if (days === 1) return "Same key since yesterday";
  if (days < 30) return `Same key for ${days} days`;

  return `Same key since ${new Date(firstSeenAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;
}

/**
 * What changed, said without guessing why.
 *
 * Somebody restoring a different seed and a server substituting a key produce
 * the same event, and only a person can tell them apart. So this says what
 * moved and what it would mean, and stops.
 */
export function describeChange(changedIdentity: boolean, changedKey: boolean): string {
  if (changedIdentity && changedKey) {
    return "Both their identity key and their message key are different from the ones seen before.";
  }
  if (changedIdentity) {
    return "A different identity key is vouching for their message key than the one seen before.";
  }
  return "Their message key is different from the one seen before, though the same identity key vouches for it.";
}

