import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

let storePath: string | null = null;
let dirty: Record<string, unknown> | null = null;

export function initGlobalStore(userDataPath: string): void {
  storePath = join(userDataPath, "gryt-global.json");
  console.log(`[GlobalStore] init: ${storePath}`);
}

function filePath(): string {
  if (!storePath) throw new Error("Global store not initialised");
  return storePath;
}

function atomicWrite(fp: string, data: Record<string, unknown>): void {
  const tmp = fp + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, fp);
}

export function loadGlobalStore(): Record<string, unknown> {
  const fp = filePath();
  try {
    if (!existsSync(fp)) {
      console.log("[GlobalStore] load: file does not exist yet");
      return {};
    }
    const data = JSON.parse(readFileSync(fp, "utf8")) as Record<string, unknown>;
    console.log(`[GlobalStore] load: ${Object.keys(data).length} keys`);
    return data;
  } catch (e) {
    console.warn("[GlobalStore] load: failed to read/parse:", e);
    return {};
  }
}

export function saveGlobalStore(data: Record<string, unknown>): void {
  console.log(`[GlobalStore] save: ${Object.keys(data).length} keys`);
  dirty = { ...data };
  atomicWrite(filePath(), dirty);
}

export function setGlobalValue(key: string, value: unknown): void {
  const data = dirty ?? loadGlobalStore();
  data[key] = value;
  dirty = data;
  atomicWrite(filePath(), data);
}

export function deleteGlobalValue(key: string): void {
  const data = dirty ?? loadGlobalStore();
  delete data[key];
  dirty = data;
  atomicWrite(filePath(), data);
}

export function flushGlobalStore(): void {
  if (!dirty) return;
  console.log(`[GlobalStore] flush: ${Object.keys(dirty).length} keys`);
  try {
    atomicWrite(filePath(), dirty);
  } catch (e) {
    console.error("[GlobalStore] flush failed:", e);
  }
}
