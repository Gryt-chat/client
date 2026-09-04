import { Button } from "@gryt/ui";

import { useSettings } from "@/settings";
import { useServerManagement } from "@/socket";
import { ServerView } from "@/socket/src/components/serverView";
import { useIsTinyWindow } from "@/socket/src/hooks/useNarrowWindow";

import { useRememberPlace } from "../lib/reports/session";
import { Discovery } from "./discovery";
import { OnboardingTour } from "./onboarding/OnboardingTour";
import { Sidebar } from "./sidebar";

export function MainApp() {
  const { servers, setShowAddServer, showDiscovery } = useServerManagement();
  const { showTour, dismissTour } = useSettings();

  /* A window this small is one channel, so the shell around it goes. At 300px
     wide the 16px of page padding is a tenth of the window and the rail another
     tenth, for a list of servers you cannot act on with no channel list beside
     it. `ServerView` drops the rest. */
  const isTiny = useIsTinyWindow();

  /* What a bug report calls "where you were". Recorded here rather than in the
     report form, which would always answer "the report form", and not in
     settings, which would always answer "About" — that is where the form is
     opened from. */
  useRememberPlace(
    showDiscovery ? "discovery" : Object.keys(servers).length > 0 ? "server" : "empty",
  );

  return (
    <div
      className={isTiny ? "flex overflow-hidden" : "flex gap-4 p-4 overflow-hidden"}
      style={{ position: "absolute", inset: 0 }}
    >
      {!isTiny && <Sidebar setShowAddServer={setShowAddServer} />}

      {showDiscovery ? (
        <Discovery />
      ) : Object.keys(servers).length > 0 ? (
        <ServerView />
      ) : (
        /* Was a line of text with a finger emoji pointing at the sidebar, which
           is the tour's job now and was never a good one for a permanent empty
           state: it explained where a button was instead of offering the thing
           the button does. Somebody who dismissed the tour still ends up here,
           so this has to stand on its own. */
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
