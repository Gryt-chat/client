export const ChatMediaPlayer = ({
  src,
  type,
  poster,
  fileName,
}: {
  src: string;
  type: "audio" | "video";
  poster?: string;
  fileName?: string | null;
}) => {
  if (type === "audio") {
    return (
      <div className="chat-audio-player">
        {fileName && <span className="chat-media-filename">{fileName}</span>}
        <audio controls preload="auto" src={src} />
      </div>
    );
  }

  return (
    <div className="chat-video-player">
      {fileName && <span className="chat-media-filename">{fileName}</span>}
      <video controls preload="metadata" playsInline poster={poster} src={src} />
    </div>
  );
};
