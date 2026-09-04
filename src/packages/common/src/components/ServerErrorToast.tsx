import { useState } from "react";

import { GeneratedServerIcon } from "./GeneratedServerIcon";

/**
 * An error toast that says which server it is about, and which channel.
 *
 * "Could not reach the voice server" on its own is not a diagnosis. Somebody
 * with three servers open gets a message that could be about any of them, and
 * the report that comes back is "voice broke" with nothing to act on.
 *
 * Deliberately presentational: it takes strings and a URL, and resolves
 * nothing. react-hot-toast renders a toast into its own subtree, so a component
 * that reached for `useSockets` to look a name up would be one refactor away
 * from rendering outside the provider that supplies it. The call site already
 * has both.
 *
 * Styles live in style.css under `.server-toast`, with the rest of the app's.
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
   * A server with no icon answers 404 here, which is the common case rather
   * than an error — the generated one is what it should have been showing all
   * along. State rather than reaching into the DOM from onError, so the two
   * branches cannot both end up rendered.
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
