import { Spinner } from "@gryt/ui";

import { useSealedVideo } from "../hooks/useSealedVideo";
import { useStableFileUrl } from "../hooks/useStableFileUrl";
import { readBlobUrl } from "../utils/downloadFile";
import { ChatMediaPlayer, ChatSealedVideo } from "./ChatMediaPlayer";
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
  // So Save As and Copy Image use that blob. The server copy is ciphertext or not there yet.
  const openLocal = local ? () => readBlobUrl(local) : undefined;
  const fileName = meta?.original_name;

  if (meta?.refused) {
    return (
      <div className="text-xs text-gryt-muted" style={{ padding: "8px 0" }}>
        {fileName ? `${fileName} couldn't be processed, so it isn't shown.` : "This file couldn't be processed, so it isn't shown."}
      </div>
    );
  }
  // Still with the server's image worker: fetching it now would just wait (GRYT-1669).
  if (meta?.processing) return <ProcessingAttachment meta={meta} />;

  if (mime.startsWith("image/")) {
    const imgSrc = local || url;
    return (
      <MessageContextMenu
        media={openLocal ? { open: openLocal, fileName, isImage: true } : { src: url, fileName, isImage: true }}
        messageActions={messageActions}
      >
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
  if (mime.startsWith("video/") && meta?.open_sealed) {
    return (
      <SealedVideoAttachment
        open={meta.open_sealed}
        fileName={fileName}
        size={meta.size}
        width={meta.width}
        height={meta.height}
        messageActions={messageActions}
        volume={chatMediaVolume}
        onVolumeChange={setChatMediaVolume}
      />
    );
  }
  if (mime.startsWith("audio/") || mime.startsWith("video/")) {
    const isVideo = mime.startsWith("video/");
    return (
      <MessageContextMenu media={openLocal ? { open: openLocal, fileName } : { src: url, fileName }} messageActions={messageActions}>
        <ChatMediaPlayer
          src={local || url}
          type={isVideo ? "video" : "audio"}
          poster={isVideo && meta?.has_thumbnail ? thumbUrl : undefined}
          fileName={meta?.original_name}
          size={meta?.size}
          width={meta?.width}
          height={meta?.height}
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
      open={openLocal}
    />
  );
}

/** An encrypted video. Its menu saves the copy decrypted for play, or decrypts one without playing. */
function SealedVideoAttachment({
  open,
  fileName,
  size,
  width,
  height,
  messageActions,
  volume,
  onVolumeChange,
}: {
  open: () => Promise<Blob>;
  fileName?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  messageActions: MessageActions;
  volume: number;
  onVolumeChange: (v: number) => void;
}) {
  const video = useSealedVideo(open);
  return (
    <MessageContextMenu media={{ open: video.file, fileName }} messageActions={messageActions}>
      <ChatSealedVideo
        video={video}
        fileName={fileName}
        size={size}
        width={width}
        height={height}
        volume={volume}
        onVolumeChange={onVolumeChange}
      />
    </MessageContextMenu>
  );
}

/** A loader in the attachment's own shape, over the sender's local copy when there is one. */
function ProcessingAttachment({ meta }: { meta: AttachmentMeta }) {
  const w = meta.width && meta.height ? Math.min(320, meta.width) : 320;
  const h = meta.width && meta.height ? Math.round((w * meta.height) / meta.width) : 180;
  return (
    <div
      role="status"
      aria-label="Processing attachment"
      className="relative flex items-center justify-center overflow-hidden rounded-(--gryt-radius-md)"
      style={{ width: w, height: Math.min(h, 360), background: "var(--gryt-neutral-3)" }}
    >
      {meta.local_url && meta.mime?.startsWith("image/") && (
        <img src={meta.local_url} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ opacity: 0.4 }} />
      )}
      <div className="relative flex items-center gap-2 text-xs">
        <Spinner size={14} />
        Processing…
      </div>
    </div>
  );
}
