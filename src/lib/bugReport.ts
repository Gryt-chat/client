import { isElectron } from "./electron";

/**
 * A pre-filled link to the bug report form.
 *
 * Issues live in the superproject rather than in any one submodule. Somebody
 * hitting a bug cannot tell whether it belongs to the client, the server or the
 * SFU — voice breaking is the obvious case — so asking them to pick a repository
 * is asking the wrong person. One front door, and the form's Component dropdown
 * sorts it out afterwards.
 *
 * The form is `Gryt-chat/gryt`'s own bug_report.yml, which predates this button.
 * Prefill is keyed by field id, so what is sent lands in the right box rather
 * than being pasted into the description.
 *
 * Only the Environment block is filled. The form's Component dropdown is
 * required and would be the obvious thing to preselect, but GitHub does not
 * prefill dropdowns on this form — checked against the live form with both the
 * option label and its index, and it stayed on None either way. Rather than
 * ship a parameter that quietly does nothing, whether this came from the
 * desktop app or a browser goes in the block that does arrive.
 */
const NEW_ISSUE_URL = "https://github.com/Gryt-chat/gryt/issues/new";

function readOs(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

/**
 * The template's Environment block with the lines the app knows filled in.
 *
 * Prefilling a textarea replaces its default wholesale, so the other lines are
 * reproduced as the template writes them — dropping them would quietly stop the
 * form asking for things that matter. Deployment and self-hosted are about the
 * server somebody connected to, which the client cannot answer for them.
 */
function environment(): string {
  return [
    `- **OS:** ${readOs()}`,
    `- **Gryt version:** ${__APP_VERSION__}`,
    `- **Reported from:** ${isElectron() ? "desktop app" : "browser"}`,
    "- **Deployment:** [Docker / source / gryt.chat]",
    "- **Self-hosted:** [yes / no]"
  ].join("\n");
}

export function bugReportUrl(): string {
  const params = new URLSearchParams({
    template: "bug_report.yml",
    environment: environment()
  });
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}
