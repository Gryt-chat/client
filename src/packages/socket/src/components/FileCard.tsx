import { Flex, Text } from "@radix-ui/themes";
import { FaDownload,FaFile, FaFileAlt, FaFileArchive, FaFileAudio, FaFileCode, FaFileImage, FaFilePdf, FaFileVideo } from "react-icons/fa";

import { getUploadsFileUrl } from "@/common";

function getFileIcon(mime: string | null) {
  if (!mime) return <FaFile size={24} />;
  if (mime.startsWith("image/")) return <FaFileImage size={24} />;
  if (mime.startsWith("audio/")) return <FaFileAudio size={24} />;
  if (mime.startsWith("video/")) return <FaFileVideo size={24} />;
  if (mime === "application/pdf") return <FaFilePdf size={24} />;
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar") || mime.includes("gzip") || mime.includes("compress")) return <FaFileArchive size={24} />;
  if (mime.includes("javascript") || mime.includes("json") || mime.includes("xml") || mime.includes("html") || mime.includes("css") || mime.includes("typescript")) return <FaFileCode size={24} />;
  if (mime.startsWith("text/")) return <FaFileAlt size={24} />;
  return <FaFile size={24} />;
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
  const downloadUrl = `${getUploadsFileUrl(serverHost, fileId)}?download=1`;
  const displayName = originalName || `${fileId.slice(0, 8)}...`;

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
      <a
        href={downloadUrl}
        className="chat-file-card-download"
        title="Download"
        download
      >
        <FaDownload size={14} />
      </a>
    </Flex>
  );
};
