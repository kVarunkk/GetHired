"use server";

import { after } from "next/server";
import { requireCompanyForAction } from "@/helpers/companies/require-company";
import { isUuid } from "@/helpers/agent/auth";
import { sendApplicationStatusEmail } from "@/helpers/email/send-application-status-email";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { TApplicationStatus } from "@/utils/types";
import type { Enums } from "@/utils/types/database.types";

type ApplicationStatus = Enums<"application_status">;

const STATUSES = new Set<string>(Object.values(TApplicationStatus));

/**
 * SERVER ACTION: changes the status of an application to one of the session
 * company's postings and, by default, emails the applicant (RS-SEC-005). The
 * recipient, job title and company name always come from the database.
 */
export async function updateApplicationStatusAction({
  applicationId,
  status,
  notify = true,
}: {
  applicationId: string;
  status: ApplicationStatus;
  notify?: boolean;
}): Promise<{ ok: true; status: ApplicationStatus } | { ok: false; error: string }> {
  const auth = await requireCompanyForAction();
  if (!auth.ok) return { ok: false, error: auth.error };
  const { supabase, company, user } = auth;

  if (typeof applicationId !== "string" || !isUuid(applicationId)) {
    return { ok: false, error: "Application not found." };
  }
  if (!STATUSES.has(status)) return { ok: false, error: "Invalid status." };

  const { data: application, error: loadError } = await supabase
    .from("applications")
    .select("id, user_info(email), job_postings!inner(company_id, title, company_info(name))")
    .eq("id", applicationId)
    .eq("job_postings.company_id", company.id)
    .maybeSingle();

  if (loadError) return { ok: false, error: "Failed to load the application." };
  if (!application) return { ok: false, error: "Application not found." };

  const { error: updateError } = await supabase
    .from("applications")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", applicationId);

  if (updateError) return { ok: false, error: "Failed to update the status." };

  const toEmail = application.user_info?.email;
  const jobTitle = application.job_postings.title;
  const companyName = application.job_postings.company_info?.name ?? company.name;

  if (notify && toEmail && companyName) {
    after(async () => {
      const sent = await sendApplicationStatusEmail({ toEmail, jobTitle, companyName, status });
      if (!sent.ok) {
        await eventCaptureServerException({
          error: new Error(sent.error),
          distinctId: user.id,
          properties: { flow: "application_status_email", applicationId },
        });
      }
    });
  }

  return { ok: true, status };
}
