export type StageEmojiViaXhrResult =
  | { ok: true; status: number; job_id: string; name: string; queued: true }
  | { ok: false; status: number; error: string; message: string };

export interface StageEmojiViaXhrParams {
  base: string;
  accessToken: string;
  file: File;
  name: string;
  onProgress?: (pct: number) => void;
  onUploadFinished?: () => void;
}

export function stageEmojiViaXhr({
  base,
  accessToken,
  file,
  name,
  onProgress,
  onUploadFinished,
}: StageEmojiViaXhrParams): Promise<StageEmojiViaXhrResult> {
  return new Promise<StageEmojiViaXhrResult>((resolve) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      if (pct >= 0 && pct <= 100) onProgress?.(pct);
    });

    xhr.upload.addEventListener("loadend", () => {
      onUploadFinished?.();
    });

    xhr.addEventListener("load", () => {
      const status = xhr.status;
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        data = null;
      }

      const root = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
      const jobsRaw = root.jobs;
      const jobs = Array.isArray(jobsRaw) ? jobsRaw : [];
      const first = jobs[0];
      const firstObj = (first && typeof first === "object") ? (first as Record<string, unknown>) : null;

      if (status >= 200 && status < 300) {
        const ok = firstObj?.ok === true;
        const job_id = typeof firstObj?.job_id === "string" ? firstObj.job_id : "";
        const outName = typeof firstObj?.name === "string" ? firstObj.name : name;
        if (ok && job_id) {
          resolve({ ok: true, status, job_id, name: outName, queued: true });
          return;
        }
      }

      const error = typeof firstObj?.error === "string" ? firstObj.error : (typeof root.error === "string" ? root.error : "http_error");
      const message = typeof firstObj?.message === "string" ? firstObj.message : (typeof root.message === "string" ? root.message : `HTTP ${status}`);
      resolve({ ok: false, status, error, message });
    });

    xhr.addEventListener("error", () => {
      resolve({ ok: false, status: 0, error: "network_error", message: "Upload failed." });
    });

    const form = new FormData();
    form.append("file", file);
    form.append("name", name);

    xhr.open("POST", `${base}/api/emojis/stage`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.send(form);
  });
}

