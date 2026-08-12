/* Hallmark · component: coach-mark tour · genre: modern-minimal · theme: @gryt/ui (locked)
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass (40-41)
 */

/**
 * What a step is allowed to do to the app when it becomes current.
 *
 * The first version of this tour only pointed at things that were already on
 * screen, so it never had to open anything. Half of what a first-run person
 * needs is behind a modal, and telling somebody "it's in Settings" is the same
 * as not telling them.
 */
export interface TourControls {
  openSettings: (tab: string) => void;
  closeSettings: () => void;
  setShowAddServer: (show: boolean) => void;
}

export interface TourStep {
  id: string;
  /** Matches a data-tour attribute in the app chrome. */
  target: string;
  title: string;
  body: string;
  /** Where the card sits relative to the target. */
  side: "right" | "top";
  /**
   * Run when the step becomes current. Opens whatever this step points into.
   * The target will not exist for a frame or two afterwards, which the tour
   * waits out rather than treating as a missing control.
   */
  enter?: (app: TourControls) => void;
}

/**
 * Five steps, in the order somebody actually needs them.
 *
 * Deliberately not a form. Each step points at the real control and says what
 * it is for; the user operates the app rather than a wizard standing in front
 * of it, and whatever they learn here still applies tomorrow. Where a control
 * lives behind a modal the tour opens it, so the route is shown once rather
 * than described.
 */
export const tourSteps: TourStep[] = [
  {
    id: "menu",
    target: "profile",
    title: "Everything about you is here",
    body: "Your profile, your settings, and signing in when you want to. Bottom left, always.",
    side: "right",
    // Closes anything a re-run of the tour left open, so step one always starts
    // from the same place.
    enter: (app) => {
      app.closeSettings();
      app.setShowAddServer(false);
    },
  },
  {
    id: "profile",
    target: "profile-editor",
    title: "Pick a name and a face",
    body: "A nickname, and a picture if you want one. Neither is permanent, and you can change them whenever.",
    side: "right",
    enter: (app) => app.openSettings("you"),
  },
  {
    id: "account",
    // The Account destination in the settings nav rather than the button inside
    // it. See the note in the PR: the panel itself is being rewritten under
    // GRYT-156, and pointing at the button would have collided with that.
    target: "settings-account",
    title: "An account, if you ever want one",
    body: "You do not need one. It carries your servers and settings between machines, and that is the only thing it is for.",
    side: "right",
    enter: (app) => app.openSettings("account"),
  },
  {
    id: "server",
    target: "add-server",
    title: "Gryt is empty until you join a server",
    body: "This is where you add one, whether it is a friend's or your own.",
    side: "right",
    enter: (app) => app.closeSettings(),
  },
  {
    id: "join",
    target: "join-address",
    title: "Paste an address to join",
    body: "A friend's invite goes straight in here. No account needed, and you can leave again whenever you like.",
    side: "top",
    enter: (app) => app.setShowAddServer(true),
  },
];
