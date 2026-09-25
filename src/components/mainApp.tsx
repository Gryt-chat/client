import { Button } from "@gryt/ui";
import { useEffect } from "react";

import { OPEN_CHANNEL_EVENT } from "@/lib/channelDirectory";
import {
  NOTIFICATION_CHANNEL_OPEN_EVENT,
  onDesktopNotificationOpen,
} from "@/lib/desktopNotification";
import { useSettings } from "@/settings";
import { DmFeeds, FriendsDialog, NewMessageDialog, useDmSpaceOpen, useRememberView, useServerManagement } from "@/socket";
import { ServerView } from "@/socket/src/components/serverView";
import { useIsTinyWindow } from "@/socket/src/hooks/useNarrowWindow";

import { useRememberPlace } from "../lib/reports/session";
import { Discovery } from "./discovery";
import { OnboardingTour } from "./onboarding/OnboardingTour";
import { Sidebar } from "./sidebar";

export function MainApp() {
  const {
    servers,
    setShowAddServer,
    showDiscovery,
    setShowDiscovery,
    currentlyViewingServer,
    switchToServer,
    setLastSelectedChannelForServer,
  } = useServerManagement();
  const { showTour, dismissTour } = useSettings();

  /* A window this small is one channel, so the shell around it goes: at 300px the
     padding and the rail are a fifth of it. `ServerView` drops the rest. */
  const isTiny = useIsTinyWindow();
  const dmSpaceOpen = useDmSpaceOpen();

  useEffect(() => {
    const open = ({ host, channelId }: { host: string; channelId: string }) => {
      if (!servers[host]) return;

      setLastSelectedChannelForServer(host, channelId);
      switchToServer(host);

      window.dispatchEvent(
        new CustomEvent(NOTIFICATION_CHANNEL_OPEN_EVENT, {
          detail: { host, channelId },
        }),
      );
    };
    // A #channel link in a message goes the same way a notification click does.
    const onLink = (event: Event) => {
      const detail = (event as CustomEvent<{ host?: string; channelId?: string }>).detail;
      if (detail?.host && detail.channelId) open({ host: detail.host, channelId: detail.channelId });
    };
    window.addEventListener(OPEN_CHANNEL_EVENT, onLink);
    const stop = onDesktopNotificationOpen(open);
    return () => {
      window.removeEventListener(OPEN_CHANNEL_EVENT, onLink);
      stop();
    };
  }, [servers, setLastSelectedChannelForServer, switchToServer]);

  /* What a bug report calls "where you were". Recorded here rather than in the
     report form, which would always answer "the report form". */
  useRememberPlace(
    showDiscovery ? "discovery" : Object.keys(servers).length > 0 ? "server" : "empty",
  );

  /* The page to reopen on the next launch. Not the one above, which is only what
     a bug report says and is never read back. */
  useRememberView({
    ready: Boolean(currentlyViewingServer),
    host: currentlyViewingServer?.host ?? null,
    dmSpaceOpen,
    showDiscovery,
    setShowDiscovery,
  });

  return (
    <div
      className={isTiny ? "flex overflow-hidden" : "flex gap-4 p-4 overflow-hidden"}
      style={{ position: "absolute", inset: 0 }}
    >
      {!isTiny && <Sidebar setShowAddServer={setShowAddServer} />}

      {/* Mounted whatever is on screen: the space needs every server's
          conversations, not just the one being looked at. */}
      <DmFeeds />
      <NewMessageDialog />
      <FriendsDialog />

      {dmSpaceOpen && Object.keys(servers).length > 0 ? (
        <ServerView dmSpace />
      ) : showDiscovery ? (
        <Discovery />
      ) : Object.keys(servers).length > 0 ? (
        <ServerView />
      ) : (
        /* Was a line of text with a finger emoji pointing at the sidebar. That is
           the tour's job; somebody who dismissed it still ends up here. */
        <div className="flex grow items-center justify-center">
          <div className="flex flex-col items-center gap-3" style={{ maxWidth: "24rem", textAlign: "center" }}>
            <h2 className="text-lg">Nothing here yet</h2>
            <span className="text-sm text-gryt-muted">
              Gryt is empty until you join a server. Add a friend&rsquo;s with an
              invite, or start one of your own.
            </span>
            <Button onClick={() => setShowAddServer(true)}>Add a server</Button>
          </div>
        </div>
      )}

      {showTour && <OnboardingTour onFinish={dismissTour} />}
    </div>
  );
}
