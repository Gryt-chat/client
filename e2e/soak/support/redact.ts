/** The app logs its ICE candidates. Public addresses are this network's, so they stay out of the files. */
export function redact(text: string): string {
  return text
    .replace(/\b(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, (ip, a, b) => (isPrivateV4(Number(a), Number(b)) ? ip : "<ip>"))
    .replace(/\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?/gi, (m) => (isPublicV6(m) ? "<ip6>" : m));
}

/** A timestamp like 08:21:50 has no letters, no `::` and two colons, so it isn't taken for one. */
function isPublicV6(m: string): boolean {
  const looksLikeIp = /[a-f]/i.test(m) || m.includes("::") || (m.match(/:/g) ?? []).length >= 5;
  return looksLikeIp && !/^\[?(fe80|fd|fc)/i.test(m);
}

function isPrivateV4(a: number, b: number): boolean {
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}
