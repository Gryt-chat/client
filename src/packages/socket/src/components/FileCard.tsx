import { useCallback } from "react";

import { PiCode, PiDownloadSimpleFill, PiFileAudioFill, PiFileFill, PiFileTextFill, PiFileVideoFill, PiFileZipFill, PiImageFill } from "../../../../lib/icons";
const FaFilePdf = PiFileTextFill;

import { getUploadsFileUrl } from "@/common";

import { saveOpenedFile, triggerDownload } from "../utils/downloadFile";
import { formatFileSize } from "../utils/formatFileSize";

function getFileIcon(mime: string | null) {
  if (!mime) return <PiFileFill size={24} />;
  if (mime.startsWith("image/")) return <PiImageFill size={24} />;
  if (mime.startsWith("audio/")) return <PiFileAudioFill size={24} />;
  if (mime.startsWith("video/")) return <PiFileVideoFill size={24} />;
  if (mime === "application/pdf") return <FaFilePdf size={24} />;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar") || mime.includes("gzip") || mime.includes("compress")) return <PiFileZipFill size={24} />;
  if (mime.includes("javascript") || mime.includes("json") || mime.includes("xml") || mime.includes("html") || mime.includes("css") || mime.includes("typescript")) return <PiCode size={24} />;
  if (mime.startsWith("text/")) return <PiFileTextFill size={24} />;
  return <PiFileFill size={24} />;
}

function mimeToLabel(mime: string | null): string {
  if (!mime) return "File";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("audio/")) return "Audio";
  if (mime.startsWith("video/")) return "Video";
  if (mime === "application/pdf") return "PDF";
  if (mime.includes("zip")) return "ZIP Archive";
  if (mime.includes("tar")) return "TAR Archive";
  if (mime.includes("rar")) return "RAR Archive";
  if (mime.includes("gzip")) return "GZIP Archive";
  const sub = mime.split("/")[1];
  if (sub) return sub.toUpperCase();
  return "File";
}

export const FileCard = ({
  fileId,
  mime,
  size,
  originalName,
  serverHost,
  open,
}: {
  fileId: string;
  mime: string | null;
  size: number | null;
  originalName: string | null;
  serverHost: string;
  /** The file itself, when it is here already. Encrypted, the server copy is ciphertext. */
  open?: () => Promise<Blob>;
}) => {
  const fileUrl = getUploadsFileUrl(serverHost, fileId);
  const displayName = originalName || `${fileId.slice(0, 8)}...`;

  const handleDownload = useCallback(() => {
    void (open ? saveOpenedFile(open, originalName) : triggerDownload(fileUrl, originalName));
  }, [fileUrl, originalName, open]);

  return (
    <div className="flex items-center gap-3 chat-file-card">
      <div className="chat-file-card-icon">
        {getFileIcon(mime)}
      </div>
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
        <span className="text-sm font-medium" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName}
        </span>
        <span className="text-xs text-gryt-muted">
          {mimeToLabel(mime)}{size != null ? ` \u2022 ${formatFileSize(size)}` : ""}
        </span>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        className="chat-file-card-download"
        title="Download"
      >
        <PiDownloadSimpleFill size={14} />
      </button>
    </div>
  );
};
