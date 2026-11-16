import type { Report } from "@gryt/core";

const NEW_ISSUE = "https://github.com/Gryt-chat/gryt/issues/new";

/** The matching issue form on GitHub, filled in with what was typed here. Same code in client and mobile. */
export function issueUrl(report: Report): string {
  const message = report.message.slice(0, 2000);
  const os = [report.device?.platform, report.device?.osVersion].filter(Boolean).join(" ");
  const version = [report.app?.version, report.app?.channel].filter(Boolean).join(" ");
  const fields: Record<string, string> =
    report.type === "bug"
      ? { template: "bug_report.yml", "what-happened": message, environment: `- **OS:** ${os}\n- **Gryt version:** ${version}` }
      : { template: "feature_request.yml", problem: message };
  return `${NEW_ISSUE}?${new URLSearchParams(fields).toString()}`;
}
