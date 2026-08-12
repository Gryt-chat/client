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
  /**
   * Controls the cursor travels to and really presses, in order.
   *
   * These are genuine pointer events, not a mime: Radix opens its menus and
   * dialogs from them, so the app does its own opening and the user watches it
   * happen. Two hops is usually the honest route — press the avatar, the menu
   * appears, press Settings in it.
   *
   * A step with `via` needs no `enter`; the presses are the action.
   */
  via?: string[];
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
    // The honest route: the avatar opens its menu, and Settings is in the menu.
    // Nothing here is simulated — these are the two presses a person makes.
    via: ["profile", "menu-settings"],
  },
  {
    id: "account",
    target: "account-signin",
    title: "An account, if you ever want one",
    body: "You do not need one. It carries your servers and settings between machines, and that is the only thing it is for.",
    side: "right",
    // Already inside Settings, so this is one press on the destination itself.
    via: ["settings-account"],
  },
  {
    id: "server",
    target: "add-server",
    title: "Gryt is empty until you join a server",
    body: "This is where you add one, whether it is a friend's or your own.",
    side: "right",
    // The panel closing needs a cause too, or it vanishes as abruptly as it
    // arrived. The cursor presses the same X the user would.
    via: ["settings-close"],
  },
  {
    id: "join",
    target: "join-address",
    title: "Paste an address to join",
    body: "A friend's invite goes straight in here. No account needed, and you can leave again whenever you like.",
    side: "top",
    // Two hops now that the dialog asks which errand you are on: open it, then
    // choose Join. The cursor makes the same choice a person would.
    via: ["add-server", "choose-join"],
  },
];
