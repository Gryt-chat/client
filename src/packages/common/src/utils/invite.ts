export type PendingInvite = {
  host: string;
  code: string;
  capturedAt: number;
};

const PENDING_INVITE_KEY = "pendingInvite";

function normalizeHost(input: string): string {
  let h = String(input || "").trim();
  h = h.replace(/^(wss?:\/\/|https?:\/\/)/i, "");
  h = h.split("/")[0] || "";
  h = h.replace(/\s+/g, "");
  return h;
}

function normalizeCode(input: string): string {
  return String(input || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function readPendingInvite(): PendingInvite | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const host = normalizeHost(parsed?.host || "");
    const code = normalizeCode(parsed?.code || "");
    if (!host || !code) return null;
    return { host, code, capturedAt: Number(parsed?.capturedAt) || Date.now() };
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // ignore
  }
}

export function capturePendingInviteFromUrl(opts?: { defaultLegacyHost?: string }): PendingInvite | null {
  if (typeof window === "undefined") return null;

  const defaultLegacyHost = normalizeHost(opts?.defaultLegacyHost || "app.gryt.chat");
  const { location, history } = window;

  const pathname = location.pathname || "/";
  const search = location.search || "";

  let host = "";
  let code = "";

  // Preferred: /invite?host=...&code=...
  const sp = new URLSearchParams(search);
  const hostParam = sp.get("host") || "";
  const codeParam = sp.get("code") || "";

  if (pathname.startsWith("/invite") && hostParam && codeParam) {
    host = hostParam;
    code = codeParam;
  } else {
    // Legacy: /invite/<code>
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] === "invite" && typeof parts[1] === "string" && parts[1].length > 0) {
      host = defaultLegacyHost;
      code = parts[1];
    }
  }

  host = normalizeHost(host);
  code = normalizeCode(code);

  if (!host || !code) return null;

  const pending: PendingInvite = { host, code, capturedAt: Date.now() };

  try {
    window.sessionStorage.setItem(PENDING_INVITE_KEY, JSON.stringify(pending));
  } catch {
    // ignore
  }

  // Clean the URL so the code doesn't remain visible longer than necessary.
  try {
    if (pathname.startsWith("/invite")) {
      history.replaceState(null, "", "/");
    } else if (sp.has("host") || sp.has("code")) {
      sp.delete("host");
      sp.delete("code");
      const nextSearch = sp.toString();
      history.replaceState(null, "", `${pathname}${nextSearch ? `?${nextSearch}` : ""}${location.hash || ""}`);
    }
  } catch {
    // ignore
  }

  return pending;
}

