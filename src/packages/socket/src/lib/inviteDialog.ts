/* What the invite dialog shows and does, decided without React so a script can check every case.
   A link carries a code, or only a host when the server lets anyone in. */

export interface InviteDialogInput {
  /** The code in the link, normalised. Empty for a link that names only the server. */
  linkCode: string;
  /** What was pasted into the dialog's own field, normalised. */
  typedCode: string;
  /** How /info answered. "info" is the only one that says anything about the server. */
  lookup: "loading" | "info" | "private" | "error";
  info: {
    identityTiers?: string[];
    joinPolicy?: string;
    lanOpen?: boolean;
  } | null;
  /** Undefined until the account check answers, and never read as signed out before then. */
  isSignedIn: boolean | undefined;
  alreadyMember: boolean;
  /** The last join came back wanting a code, or refusing the one it was given. */
  inviteRequired: boolean;
  /** The last join came back wanting an account. */
  accountRequired: boolean;
  /** Asked on a server that lets people in by hand. Nothing to press until somebody answers. */
  awaitingApproval: boolean;
}

export type InviteDialogMessage = "member" | "invited" | "needs-code" | "request" | "open" | "private" | "none";

export type InviteDialogAction =
  | { kind: "go-to-server" }
  | { kind: "sign-in" }
  | { kind: "join"; label: "Accept Invite" | "Ask to join" | "Join"; disabled: boolean }
  | { kind: "none" };

export interface InviteDialogView {
  message: InviteDialogMessage;
  /** Whether the server wants an account this person doesn't have yet. */
  needsAccount: boolean;
  showCodeField: boolean;
  /** Sent with the join. A link's code goes even to an open server, so a role on it still lands. */
  code: string;
  /** The optional line for whoever lets people in, on a server that admits by request. */
  showNote: boolean;
  action: InviteDialogAction;
}

function dialogMessage(s: {
  alreadyMember: InviteDialogInput["alreadyMember"];
  invited: boolean;
  showCodeField: boolean;
  policy: string | undefined;
  lookup: InviteDialogInput["lookup"];
}): InviteDialogMessage {
  if (s.alreadyMember) return "member";
  if (s.invited) return "invited";
  if (s.showCodeField && s.policy !== "open") return "needs-code";
  if (s.policy === "request") return "request";
  if (s.policy === "open") return "open";
  return s.lookup === "private" ? "private" : "none";
}

function dialogAction(s: {
  alreadyMember: InviteDialogInput["alreadyMember"];
  awaitingApproval: InviteDialogInput["awaitingApproval"];
  needsAccount: boolean;
  label: Extract<InviteDialogAction, { kind: "join" }>["label"];
  disabled: boolean;
}): InviteDialogAction {
  if (s.alreadyMember) return { kind: "go-to-server" };
  if (s.awaitingApproval) return { kind: "none" };
  if (s.needsAccount) return { kind: "sign-in" };
  return { kind: "join", label: s.label, disabled: s.disabled };
}

function joinLabel(policy: string | undefined): "Ask to join" | "Join" {
  return policy === "request" ? "Ask to join" : "Join";
}

export function inviteDialogView(input: InviteDialogInput): InviteDialogView {
  const { info, linkCode, typedCode } = input;
  const policy = info?.joinPolicy;

  const needsAccount =
    input.isSignedIn === false &&
    (input.accountRequired || (!!info?.identityTiers && !info.identityTiers.includes("local")));

  // A refused link code is replaced by whatever gets typed, which may be nothing on an open server.
  const linkCodeRefused = !!linkCode && input.inviteRequired;
  const code = linkCode && !linkCodeRefused ? linkCode : typedCode;
  const showCodeField = input.inviteRequired || (!linkCode && policy === "invite");
  // Open lets anyone in, and LAN open lets in whoever is on the network, so neither can require it.
  const codeRequired =
    showCodeField && policy !== "open" && !(policy === "invite" && info?.lanOpen && !input.inviteRequired);

  const invited = !!linkCode && !linkCodeRefused;
  const message = dialogMessage({ alreadyMember: input.alreadyMember, invited, showCodeField, policy, lookup: input.lookup });

  const action: InviteDialogAction = dialogAction({
    alreadyMember: input.alreadyMember,
    awaitingApproval: input.awaitingApproval,
    needsAccount,
    label: invited ? "Accept Invite" : joinLabel(policy),
    disabled: input.lookup === "loading" || (codeRequired && code.length === 0),
  });

  return {
    message,
    needsAccount,
    showCodeField: showCodeField && !input.alreadyMember,
    code,
    showNote: !invited && policy === "request" && !input.awaitingApproval && !input.alreadyMember,
    action,
  };
}
