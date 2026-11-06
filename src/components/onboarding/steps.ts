import type { Mood } from "./GuideOwl";

/**
 * What a step is allowed to do to the app when it becomes current. Half of what a
 * first-run person needs is behind a modal.
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
  /** What the owl says when the step starts. One short instruction. */
  line: string;
  /** Happy eyes, kept for hello and goodbye. */
  mood?: Mood;
  /**
   * Run when the step becomes current. Opens whatever this step points into; the
   * target will not exist for a frame or two, which the tour waits out.
   */
  enter?: (app: TourControls) => void;
  /**
   * Controls the cursor travels to and really presses, in order. Genuine pointer
   * events, so the app does its own opening. A step with `via` needs no `enter`.
   */
  via?: string[];
}

/**
 * Six steps, in the order somebody actually needs them. Each points at the real
 * control, so what they learn here still applies tomorrow.
 */
export const tourSteps: TourStep[] = [
  {
    id: "menu",
    target: "profile",
    line: "Your profile and settings are here.",
    mood: "happy",
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
    line: "Pick a name and a picture. You can change them anytime.",
    // The honest route: the avatar opens its menu, and Settings is in the menu.
    // Nothing here is simulated — these are the two presses a person makes.
    via: ["profile", "menu-settings"],
    // Settings reopens on the last tab, which is About when the tour starts from there.
    enter: (app) => app.openSettings("profile"),
  },
  {
    id: "account",
    target: "account-signin",
    line: "You don't need an account. It syncs your servers and settings between devices.",
    // Already inside Settings, so this is one press on the destination itself.
    via: ["settings-account"],
    // A narrow window has a picker instead of that button, so the hop is skipped and this opens the page.
    enter: (app) => app.openSettings("account"),
  },
  {
    id: "server",
    target: "add-server",
    line: "Gryt is empty until you join a server. Add one here.",
    // The panel closing needs a cause too, or it vanishes as abruptly as it
    // arrived. The cursor presses the same X the user would.
    via: ["settings-close"],
  },
  {
    id: "join",
    target: "join-address",
    line: "Paste an invite link or a server address.",
    // Two hops now that the dialog asks which errand you are on: open it, then
    // choose Join. The cursor makes the same choice a person would.
    via: ["add-server", "choose-join"],
  },
  {
    id: "community",
    target: "official-server",
    line: "Or come say hi on Gryt Chat, the server we run.",
    mood: "happy",
    // Already on the join screen. Hidden, joined or unreachable, and the tour ends a step early.
  },
];
