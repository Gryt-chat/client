/* Hallmark · component: coach-mark tour · genre: modern-minimal · theme: @gryt/ui (locked)
 * states: default · hover · focus · active · disabled · loading · error · success
 * contrast: pass (40-41)
 */

export interface TourStep {
  id: string;
  /** Matches a data-tour attribute in the app chrome. */
  target: string;
  title: string;
  body: string;
  /** Where the card sits relative to the target. */
  side: "right" | "top";
}

/**
 * Three steps, in the order a new account actually needs them.
 *
 * Deliberately not a form. Each step points at the real control and says what
 * it is for; the user operates the app rather than a wizard standing in front
 * of it, and whatever they learn here still applies tomorrow.
 */
export const tourSteps: TourStep[] = [
  {
    id: "profile",
    target: "profile",
    title: "Make yourself recognisable",
    // Nickname and picture are one step because they live on one screen, and
    // the picture is optional — saying so is what keeps this from reading as a
    // form with two required fields.
    body: "Open your profile to pick a nickname, and a picture if you want one. Neither is permanent.",
    side: "right"
  },
  {
    id: "server",
    target: "add-server",
    title: "Add a server",
    body: "Gryt is empty until you join one. Add a friend's server with an invite, or spin up your own.",
    side: "right"
  },
  {
    // Same anchor as step 1 on purpose. The voice controls are 0x0 until a
    // connection exists, so at first run there is nothing to point at — but
    // Sound & video sits behind this button too, and pointing at the real
    // route beats pointing at an element that is not there.
    id: "audio",
    target: "profile",
    title: "Check your microphone",
    body: "Worth thirty seconds now rather than finding out mid-conversation. Settings, then Sound & video.",
    side: "right"
  }
];
