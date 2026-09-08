/**
 * How a key's history and a key's change are put into words. This is the part
 * that can be wrong without looking wrong — "same key for 0 days" (GRYT-728).
 */

/**
 * When a key was pinned, in words rather than a date nobody reads. A key seen
 * once yesterday and one seen daily for a year both verify.
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
 * What changed, said without guessing why. A restored seed and a substituted key
 * produce the same event, and only a person can tell them apart.
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

