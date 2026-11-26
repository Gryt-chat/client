import { getServerHttpBase } from "./url";

// In memory only: a picture picked on Create waits for the first join, which is when the creator becomes owner.
const pending = new Map<string, File>();

export function setPendingServerIcon(host: string, file: File): void {
  pending.set(host, file);
}

export async function uploadPendingServerIcon(host: string, accessToken: string): Promise<boolean> {
  const file = pending.get(host);
  if (!file) return false;
  pending.delete(host);
  const form = new FormData();
  form.append("file", file);
  const resp = await fetch(`${getServerHttpBase(host)}/api/server/icon`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  if (!resp.ok) throw new Error("Couldn't set the server picture. You can set it in Server settings.");
  return true;
}
