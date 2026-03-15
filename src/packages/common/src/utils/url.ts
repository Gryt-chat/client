const PRIVATE_HOST_RE =
  /^(localhost|::1|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i;

function isElectronRenderer(): boolean {
  try {
    return navigator.userAgent.toLowerCase().includes("electron");
  } catch {
    return false;
  }
}

function isSecure(host: string): boolean {
  if (!PRIVATE_HOST_RE.test(host)) return true;

  try {
    const proto = window.location.protocol;
    if (proto === "http:" || proto === "file:") return false;
    if (isElectronRenderer()) return false;
    if ((window as Window & { electronAPI?: unknown }).electronAPI)
      return false;
  } catch {
    // ignore
  }

  return true;
}

export function getServerHttpBase(host: string): string {
  return `${isSecure(host) ? "https" : "http"}://${host}`;
}

export function getServerWsBase(host: string): string {
  return `${isSecure(host) ? "wss" : "ws"}://${host}`;
}

export function getUploadsFileUrl(
  host: string,
  fileId: string,
  opts?: { thumb?: boolean }
): string {
  const base = getServerHttpBase(host);
  const q = opts?.thumb ? "?thumb=1" : "";
  return `${base}/api/uploads/files/${fileId}${q}`;
}
