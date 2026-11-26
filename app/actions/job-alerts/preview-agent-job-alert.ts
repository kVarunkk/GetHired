"use server";

import { previewJobAlert, type JobAlertPreview, type JobAlertTool } from "@/helpers/job-alerts/preview";
import { requireAlertSession } from "@/helpers/job-alerts/session";
import { reportError } from "@/helpers/posthog/report-error";

/**
 * SERVER ACTION: the agent's approval card for a proposed `createJobAlert` or
 * `updateJobAlert` call (see `previewJobAlert`). Writes nothing. The applicant
 * comes from the session.
 */
export async function previewAgentJobAlertAction(tool: JobAlertTool, input: unknown): Promise<JobAlertPreview> {
  const session = await requireAlertSession();
  if (!session.ok) return { ok: false, error: session.error };
  if (tool !== "createJobAlert" && tool !== "updateJobAlert") {
    return { ok: false, error: "Couldn't load the preview." };
  }
  try {
    return await previewJobAlert(session.ctx, tool, input);
  } catch (error) {
    reportError("[job alerts] couldn't preview an alert", error);
    return { ok: false, error: "Couldn't load the preview." };
  }
}
