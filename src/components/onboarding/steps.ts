import type { Mood } from "./GuideOwl";

/**
 * What a step is allowed to do to the app when it becomes current. Half of what a
 * first-run person needs is behind a modal.
 */
export interface TourControls {
  openSettings: (tab: string) => void;
  closeSettings: () => void;
  setShowAddServer: (show: boolean) => void;
  /** On the server the tour is about; a no-op on the first-run tour. */
  openServerSettings: (tab: string) => void;
}

export interface TourStep {
  id: string;
  /** Matches a data-tour attribute in the app chrome. */
  target: string;
  title: string;
  body: string;
  /** The face it makes once it has said the line. Kept to a couple of steps. */
  mood?: Mood;
  /** Points at the target while it talks, as in the film. False keeps the arm in. */
  point?: boolean;
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
    title: "Everything about you is here",
    body: "Your profile, your settings, and signing in when you want to, all from this menu.",
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
    mood: "wink",
    // The honest route: the avatar opens its menu, and Settings is in the menu.
    // Nothing here is simulated — these are the two presses a person makes.
    via: ["profile", "menu-settings"],
    // Settings reopens on the last tab, which is About when the tour starts from there.
    enter: (app) => app.openSettings("profile"),
  },
  {
    id: "account",
    target: "account-signin",
    title: "An account, if you want one",
    body: "Gryt works without one. An account gives you a way back in if you lose this device, and makes you the same person on every server. Some servers only let in people who have one.",
    // Already inside Settings, so this is one press on the destination itself.
    via: ["settings-account"],
    // A narrow window has a picker instead of that button, so the hop is skipped and this opens the page.
    enter: (app) => app.openSettings("account"),
  },
  {
    id: "server",
    target: "add-server",
    title: "Gryt is empty until you join a server",
    body: "This is where you add one, whether it is a friend's or your own.",
    // The owl presses the same X the user would, so the panel closing has a cause.
    via: ["settings-close"],
    // Coming back from the join step, its dialog would cover this.
    enter: (app) => app.setShowAddServer(false),
  },
  {
    id: "join",
    target: "join-address",
    title: "Paste an invite to join",
    body: "A friend's invite link goes straight in here, and a plain address works too. It tells you whether the server needs an account before you join.",
    // Two hops now that the dialog asks which errand you are on: open it, then
    // choose Join. The cursor makes the same choice a person would.
    via: ["add-server", "choose-join"],
  },
  {
    id: "community",
    target: "official-server",
    title: "Or join our official server 👋",
    body: "Gryt Chat is the server we host. Come say hi, ask anything, or tell us what's broken.",
    mood: "happy",
    // Already on the join screen. Hidden, joined or unreachable, and the tour ends a step early.
  },
];

/** The first time somebody owns a server: where its settings are, in the order an owner needs them. */
export const ownerTourSteps: TourStep[] = [
  {
    id: "owner-name",
    target: "server-name",
    title: "This is your server",
    body: "Give it a name, an icon and a line about what it's for. It's the first thing people see when they join.",
    enter: (app) => app.openServerSettings("overview"),
  },
  {
    id: "owner-join",
    target: "server-join",
    title: "Decide who gets in",
    body: "With an invite, after you let them in, or anyone who has the address. You can change it whenever.",
  },
  {
    id: "owner-roles",
    target: "server-settings-role-editor",
    title: "Roles decide who can do what",
    body: "Give your moderators what they need here, and keep the rest for yourself.",
    via: ["server-settings-role-editor"],
  },
  {
    id: "owner-uploads",
    target: "server-uploads",
    title: "Pictures and videos",
    body: "How big uploads may be, and how videos in chat are stored. Higher quality fills your storage faster.",
    mood: "wink",
    enter: (app) => app.openServerSettings("overview"),
  },
];
