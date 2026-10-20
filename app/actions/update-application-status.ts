"use server";

import { requireCompanyForAction } from "@/helpers/companies/require-company";
import {
  updateApplicationStatus,
  type UpdateApplicationStatusResult,
} from "@/helpers/applications/update-application-status";
import type { Enums } from "@/utils/types/database.types";

/**
 * SERVER ACTION: changes the status of an application to one of the session
 * company's postings and, by default, emails the applicant (RS-SEC-005). The
 * work is in `helpers/applications/update-application-status.ts`, shared with
 * the agent.
 */
export async function updateApplicationStatusAction(params: {
  applicationId: string;
  status: Enums<"application_status">;
  notify?: boolean;
}): Promise<UpdateApplicationStatusResult> {
  const auth = await requireCompanyForAction({ permission: "pipeline.move" });
  if (!auth.ok) return { ok: false, error: auth.error };
  return updateApplicationStatus(auth, params);
}
