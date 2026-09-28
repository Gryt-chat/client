import type { MlsServerCapability } from "@gryt/core";

/** `server:info.mls`, and only suite 1 and version 1, which is all this app speaks. */
export function readMlsCapability(value: unknown): MlsServerCapability | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<MlsServerCapability>;
  if (v.version !== 1 || !Array.isArray(v.ciphersuites) || !v.ciphersuites.includes(1)) return null;
  return { version: 1, ciphersuites: v.ciphersuites, retentionDays: Number(v.retentionDays) || 30 };
}
