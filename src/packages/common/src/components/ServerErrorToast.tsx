import { useState } from "react";

import { GeneratedServerIcon } from "./GeneratedServerIcon";

/**
 * An error toast that says which server and channel it is about. Presentational:
 * react-hot-toast renders into its own subtree, outside the providers.
 */
export interface ServerErrorToastProps {
  /** The server's own icon, or undefined to draw the generated one. */
  iconSrc?: string;
  /** Seeds the generated icon when `iconSrc` is missing or fails. */
  seed: string;
  serverName: string;
  /** Omitted when the error is not about one channel in particular. */
  channelName?: string;
  message: string;
}

export function ServerErrorToast({
  iconSrc,
  seed,
  serverName,
  channelName,
  message,
}: ServerErrorToastProps) {
  /*
   * A server with no icon answers 404 here, which is the common case. State
   * rather than the DOM, so the two branches cannot both end up rendered.
   */
  const [iconFailed, setIconFailed] = useState(false);
  const showUploaded = Boolean(iconSrc) && !iconFailed;

  return (
    <div className="server-toast">
      <div className="server-toast-icon">
        {showUploaded ? (
          <img src={iconSrc} alt="" onError={() => setIconFailed(true)} />
        ) : (
          <GeneratedServerIcon seed={seed} />
        )}
      </div>

      <div className="server-toast-body">
        <div className="server-toast-where">
          <span className="server-toast-server">{serverName}</span>
          {channelName ? <span className="server-toast-channel">{channelName}</span> : null}
        </div>
        <div className="server-toast-message">{message}</div>
      </div>
    </div>
  );
}
