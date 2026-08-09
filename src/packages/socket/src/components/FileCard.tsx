import { Flex, Text } from "@radix-ui/themes";
import { useCallback } from "react";
import { PiCode, PiDownloadSimple, PiFile, PiFileAudio, PiFileText, PiFileVideo, PiFileZip, PiImage } from "react-icons/pi";
const FaFilePdf = PiFileText;

import { getUploadsFileUrl } from "@/common";

import { triggerDownload } from "../utils/downloadFile";

function getFileIcon(mime: string | null) {
  if (!mime) return <PiFile size={24} />;
  if (mime.startsWith("image/")) return <PiImage size={24} />;
  if (mime.startsWith("audio/")) return <PiFileAudio size={24} />;
  if (mime.startsWith("video/")) return <PiFileVideo size={24} />;
  if (mime === "application/pdf") return <FaFilePdf size={24} />;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar") || mime.includes("gzip") || mime.includes("compress")) return <PiFileZip size={24} />;
  if (mime.includes("javascript") || mime.includes("json") || mime.includes("xml") || mime.includes("html") || mime.includes("css") || mime.includes("typescript")) return <PiCode size={24} />;
  if (mime.startsWith("text/")) return <PiFileText size={24} />;
  return <PiFile size={24} />;
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
}: {
  fileId: string;
  mime: string | null;
  size: number | null;
  originalName: string | null;
  serverHost: string;
}) => {
  const fileUrl = getUploadsFileUrl(serverHost, fileId);
  const displayName = originalName || `${fileId.slice(0, 8)}...`;

  const handleDownload = useCallback(() => {
    void triggerDownload(fileUrl, originalName);
  }, [fileUrl, originalName]);

  return (
    <Flex className="chat-file-card" align="center" gap="3">
      <div className="chat-file-card-icon">
        {getFileIcon(mime)}
      </div>
      <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
        <Text size="2" weight="medium" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {displayName}
        </Text>
        <Text size="1" color="gray">
          {mimeToLabel(mime)}{size != null ? ` \u2022 ${formatFileSize(size)}` : ""}
        </Text>
      </Flex>
      <button
        type="button"
        onClick={handleDownload}
        className="chat-file-card-download"
        title="Download"
      >
        <PiDownloadSimple size={14} />
      </button>
    </Flex>
  );
};
