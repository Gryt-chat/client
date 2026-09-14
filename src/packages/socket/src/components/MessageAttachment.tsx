import { useStableFileUrl } from "../hooks/useStableFileUrl";
import { ChatMediaPlayer } from "./ChatMediaPlayer";
import type { AttachmentMeta } from "./chatUtils";
import { FileCard } from "./FileCard";
import { ImageAttachment } from "./ImageAttachment";
import { type MessageActions, MessageContextMenu } from "./MediaContextMenu";

/** One attachment on a message. Its own component so its URLs survive a file token refresh. */
export function MessageAttachment({
  fileId,
  meta,
  serverHost,
  messageActions,
  onLightboxOpen,
  chatMediaVolume,
  setChatMediaVolume,
}: {
  fileId: string;
  meta: AttachmentMeta | undefined;
  serverHost: string;
  messageActions: MessageActions;
  onLightboxOpen: (src: string, alt?: string) => void;
  chatMediaVolume: number;
  setChatMediaVolume: (v: number) => void;
}) {
  const [url, refreshUrl] = useStableFileUrl(serverHost, fileId);
  const [thumbUrl, refreshThumb] = useStableFileUrl(serverHost, fileId, true);
  const mime = meta?.mime || "";
  // A sealed or still-sending attachment is already here as a blob; only the server copy has a token.
  const local = meta?.local_url;

  if (mime.startsWith("image/")) {
    const imgSrc = local || url;
    return (
      <MessageContextMenu media={{ src: url, fileName: meta?.original_name, isImage: true }} messageActions={messageActions}>
        <ImageAttachment
          src={imgSrc}
          alt={meta?.original_name || "Attachment"}
          width={meta?.width}
          height={meta?.height}
          onError={local ? undefined : refreshUrl}
          onClick={() => onLightboxOpen(imgSrc, meta?.original_name || "Attachment")}
        />
      </MessageContextMenu>
    );
  }
  if (mime.startsWith("audio/") || mime.startsWith("video/")) {
    const isVideo = mime.startsWith("video/");
    return (
      <MessageContextMenu media={{ src: url, fileName: meta?.original_name }} messageActions={messageActions}>
        <ChatMediaPlayer
          src={local || url}
          type={isVideo ? "video" : "audio"}
          poster={isVideo && meta?.has_thumbnail ? thumbUrl : undefined}
          fileName={meta?.original_name}
          size={meta?.size}
          volume={chatMediaVolume}
          onVolumeChange={setChatMediaVolume}
          onError={local ? undefined : refreshUrl}
          onPosterError={refreshThumb}
        />
      </MessageContextMenu>
    );
  }
  return (
    <FileCard
      fileId={fileId}
      mime={meta?.mime ?? null}
      size={meta?.size ?? null}
      originalName={meta?.original_name ?? null}
      serverHost={serverHost}
    />
  );
}
