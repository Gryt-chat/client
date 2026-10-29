import { type DiscordPackageMessage, importBatches, type MlsDmContent, type MlsImportEntry } from "@gryt/core";
import type { SealedAttachmentKey } from "@gryt/crypto";

/** What the job needs from the app, so it can run against fakes in a check. */
export interface ImportDeps {
  send: (content: MlsDmContent) => Promise<void>;
  upload: (file: File) => Promise<{ id: string; key: SealedAttachmentKey }>;
  fetchFile: (url: string) => Promise<Response>;
  cache: Pick<Cache, "match" | "put" | "delete">;
  sleep: (ms: number) => Promise<void>;
}

export interface ImportProgress {
  messages: { done: number; total: number };
  downloaded: { done: number; total: number };
  sent: { done: number; total: number };
  missing: number;
  bytes: number;
  startedAt: number;
}

export interface ImportControl {
  paused: () => boolean;
  stopped: () => boolean;
}

const DOWNLOADS_AT_ONCE = 4;
/** `mls:send` allows about one send every two seconds sustained (RL_SEND in the server). */
const SEND_GAP_MS = 2_000;
const FILE_BATCH = 20;

export const importId = (discordId: string) => `discord-${discordId}`;

function nameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || "file");
  } catch {
    return "file";
  }
}

/** Messages first, then every file downloaded to the cache, then the messages that carry files. */
export async function runDiscordImport(
  messages: DiscordPackageMessage[],
  deps: ImportDeps,
  control: ImportControl,
  report: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  const withFiles = messages.filter((m) => m.attachments.length > 0);
  const urls = [...new Set(withFiles.flatMap((m) => m.attachments))];
  const p: ImportProgress = {
    messages: { done: 0, total: messages.length },
    downloaded: { done: 0, total: urls.length },
    sent: { done: 0, total: urls.length },
    missing: 0,
    bytes: 0,
    startedAt: Date.now(),
  };
  const tick = () => report({ ...p, messages: { ...p.messages }, downloaded: { ...p.downloaded }, sent: { ...p.sent } });
  tick();
  const hold = async () => {
    while (control.paused() && !control.stopped()) await deps.sleep(500);
  };
  const sendAll = async (entries: MlsImportEntry[]) => {
    for (const batch of importBatches(entries, () => crypto.randomUUID())) {
      await hold();
      if (control.stopped()) return;
      await deps.send(batch);
      p.messages.done += batch.entries.length;
      tick();
      await deps.sleep(SEND_GAP_MS);
    }
  };

  await sendAll(messages.filter((m) => m.attachments.length === 0).map((m) => ({ id: importId(m.discordId), sentAt: m.sentAt, text: m.text })));

  const missing = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (!control.stopped()) {
      await hold();
      if (next >= urls.length) break;
      const url = urls[next++];
      if (!(await deps.cache.match(url))) {
        const res = await deps.fetchFile(url).catch(() => null);
        if (res?.ok) {
          const blob = await res.blob();
          p.bytes += blob.size;
          await deps.cache.put(url, new Response(blob, { headers: { "content-type": res.headers.get("content-type") ?? "" } }));
        } else {
          missing.add(url);
          p.missing = missing.size;
        }
      }
      p.downloaded.done++;
      tick();
    }
  };
  await Promise.all(Array.from({ length: DOWNLOADS_AT_ONCE }, worker));

  const uploaded = new Map<string, { id: string; key: SealedAttachmentKey }>();
  let pending: MlsImportEntry[] = [];
  for (const m of withFiles) {
    if (control.stopped()) break;
    const attachments: Record<string, SealedAttachmentKey> = {};
    for (const url of m.attachments) {
      await hold();
      let up = uploaded.get(url);
      const cached = up || missing.has(url) ? undefined : await deps.cache.match(url);
      if (cached) {
        const blob = await cached.blob();
        up = await deps.upload(new File([blob], nameOf(url), { type: blob.type }));
        uploaded.set(url, up);
        await deps.cache.delete(url);
      }
      if (up) attachments[up.id] = up.key;
      p.sent.done++;
      tick();
    }
    const lost = m.attachments.length - Object.keys(attachments).length;
    const note = lost ? `${lost === 1 ? "A file" : `${lost} files`} from Discord couldn’t be downloaded.` : "";
    const text = [m.text, note].filter(Boolean).join("\n");
    pending.push({ id: importId(m.discordId), sentAt: m.sentAt, text, ...(Object.keys(attachments).length ? { attachments } : {}) });
    if (pending.length >= FILE_BATCH) {
      await sendAll(pending);
      pending = [];
    }
  }
  if (pending.length) await sendAll(pending);
  tick();
  return p;
}
