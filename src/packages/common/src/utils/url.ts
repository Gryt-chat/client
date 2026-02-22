function isSecure(host: string): boolean {
  const isLocalhost = /^(localhost|127\.\d+\.\d+\.\d+)(:\d+)?$/.test(host);
  try {
    if (window.location.protocol === "http:" && isLocalhost) return false;
  } catch { /* location may be unavailable in non-browser context */ }
  return true;
}

export function getServerHttpBase(host: string): string {
  return `${isSecure(host) ? "https" : "http"}://${host}`;
}

export function getServerWsBase(host: string): string {
  return `${isSecure(host) ? "wss" : "ws"}://${host}`;
}

export function getUploadsFileUrl(host: string, fileId: string, opts?: { thumb?: boolean }): string {
  const base = getServerHttpBase(host);
  const q = opts?.thumb ? "?thumb=1" : "";
  return `${base}/api/uploads/files/${fileId}${q}`;
}

