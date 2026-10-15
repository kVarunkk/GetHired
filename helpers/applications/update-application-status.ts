import { after } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { isUuid } from "@/helpers/agent/auth";
import { sendApplicationStatusEmail } from "@/helpers/email/send-application-status-email";
import { moveApplications } from "@/helpers/pipeline/move";
import { listStages, type PipelineStage } from "@/helpers/pipeline/stages";
import { inverseKind, statusForKind } from "@/helpers/pipeline/status-map";
import { eventCaptureServerException } from "@/helpers/posthog/EventCaptureServerException";
import { TApplicationStatus } from "@/utils/types";
import type { Database, Enums } from "@/utils/types/database.types";

type ApplicationStatus = Enums<"application_status">;

export type UpdateApplicationStatusResult =
  | { ok: true; status: ApplicationStatus }
  | { ok: false; error: string };

const STATUSES = new Set<string>(Object.values(TApplicationStatus));

/**
 * The stage a status-only caller lands in: the first active stage of the
 * inverse kind (`reviewed` → Screening), or, if the company archived that
 * one, the first active stage that shows the same status.
 */
function stageForStatus(stages: PipelineStage[], status: ApplicationStatus) {
  return (
    stages.find((s) => s.kind === inverseKind(status)) ??
    stages.find((s) => statusForKind(s.kind) === status)
  );
}

/**
 * Changes the status of an application to one of `company`'s postings and, by
 * default, emails the applicant (RS-SEC-005). Since the pipeline spec this is
 * a thin wrapper (PLT-031): it moves the application to the stage that shows
 * `status` through `moveApplications`, so the move is logged like any other.
 * An application already in a stage with that status stays where it is. The
 * recipient, job title and company name always come from the database.
 * Shared by the server action and the recruiter agent; `company` and `user`
 * must come from the session.
 */
export async function updateApplicationStatus(
  ctx: { supabase: SupabaseClient<Database>; company: MyCompany; user: User },
  {
    applicationId,
    status,
    notify = true,
  }: {
    applicationId: string;
    status: ApplicationStatus;
    notify?: boolean;
  },
): Promise<UpdateApplicationStatusResult> {
  if (typeof applicationId !== "string" || !isUuid(applicationId)) {
    return { ok: false, error: "Application not found." };
  }
  if (!STATUSES.has(status)) return { ok: false, error: "Invalid status." };

  let stages: PipelineStage[];
  try {
    stages = await listStages(ctx);
  } catch {
    return { ok: false, error: "Failed to load the pipeline stages." };
  }
  const stage = stageForStatus(stages, status);
  if (!stage) return { ok: false, error: "No active pipeline stage shows that status." };

  const moved = await moveApplications(ctx, {
    applicationIds: [applicationId],
    stageId: stage.id,
    sameStatusIsNoop: true,
  });
  if (!moved.ok) return { ok: false, error: "Failed to update the status." };

  const application = moved.applications[0];
  if (!application) return { ok: false, error: "Application not found." };

  const toEmail = application.email;
  const jobTitle = application.jobTitle;
  const companyName = application.companyName;

  if (notify && toEmail && companyName) {
    after(async () => {
      const sent = await sendApplicationStatusEmail({ toEmail, jobTitle, companyName, status });
      if (!sent.ok) {
        await eventCaptureServerException({
          error: new Error(sent.error),
          distinctId: ctx.user.id,
          properties: { flow: "application_status_email", applicationId },
        });
      }
    });
  }

  return { ok: true, status };
}
