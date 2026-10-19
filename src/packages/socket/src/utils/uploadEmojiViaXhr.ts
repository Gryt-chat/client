export type UploadEmojiViaXhrResult =
  | { ok: true; status: number; name: string; file_id: string }
  | { ok: false; status: number; error: string; message: string };

export interface UploadEmojiViaXhrParams {
  base: string;
  accessToken: string;
  file: File;
  name: string;
  onProgress?: (pct: number) => void;
  onUploadFinished?: () => void;
}

export function uploadEmojiViaXhr({
  base,
  accessToken,
  file,
  name,
  onProgress,
  onUploadFinished,
}: UploadEmojiViaXhrParams): Promise<UploadEmojiViaXhrResult> {
  return new Promise<UploadEmojiViaXhrResult>((resolve) => {
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

      if (status >= 200 && status < 300) {
        const root = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
        const outName = typeof root.name === "string" ? root.name : name;
        const outFileId = typeof root.file_id === "string" ? root.file_id : "";
        if (!outFileId) {
          resolve({
            ok: false,
            status,
            error: "invalid_response",
            message: "Server returned an invalid emoji payload.",
          });
          return;
        }
        resolve({ ok: true, status, name: outName, file_id: outFileId });
        return;
      }

      const root = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
      const error = typeof root.error === "string" ? root.error : "http_error";
      const message = typeof root.message === "string" ? root.message : `HTTP ${status}`;
      resolve({ ok: false, status, error, message });
    });

    xhr.addEventListener("error", () => {
      resolve({ ok: false, status: 0, error: "network_error", message: "Upload failed." });
    });

    const form = new FormData();
    form.append("file", file);
    form.append("name", name);

    xhr.open("POST", `${base}/api/emojis`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.send(form);
  });
}

