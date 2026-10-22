import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import { cache } from "react";
import { isUuid } from "@/helpers/agent/auth";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { getApplicationInterview } from "@/helpers/interview/screening/application-interview";
import { getInterviewConfig } from "@/helpers/interview/screening/config";
import { createClient } from "@/lib/supabase/server";

export const applicationPath = (applicationId: string) => `/company/applications/${applicationId}`;

/**
 * What every page of an application's layout needs: the session, the
 * company and the application with its candidate's name and job. Cached for
 * the request, so the layout and the section page share one load. Null when
 * the application isn't there (RLS: only the job's company members can read
 * it, MT-SEC-004) or the viewer isn't a company member.
 */
export const loadApplicationFrame = cache(async (applicationId: string) => {
  if (!isUuid(applicationId)) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [company, { data: application, error }] = await Promise.all([
    getMyCompany(supabase, user),
    supabase
      .from("applications")
      .select(
        "id, applicant_user_id, created_at, status, stage_id, job_post_id, user_info(full_name), job_postings(id, title, company_id)",
      )
      .eq("id", applicationId)
      .maybeSingle(),
  ]);
  if (error) throw error;
  if (!company || !application) return null;
  return { supabase, user, company, application, jobId: application.job_post_id ?? undefined };
});

/**
 * SIT-063/064: the application's AI interview (interviews.view) and, for
 * interviews.manage, the job's interview config. Extra: a failure hides
 * them, not the page.
 */
export const loadApplicationInterview = cache(async (applicationId: string) => {
  const frame = await loadApplicationFrame(applicationId);
  const empty = { canView: false, canManage: false, interview: null, config: null } as const;
  if (!frame?.jobId) return empty;
  const { supabase, company, jobId } = frame;
  const canView = can(company, "interviews.view", jobId);
  const canManage = can(company, "interviews.manage", jobId);
  if (!canView) return { ...empty, canManage };
  try {
    const [interview, config] = await Promise.all([
      getApplicationInterview(supabase, applicationId),
      canManage ? getInterviewConfig(supabase, jobId) : null,
    ]);
    return { canView, canManage, interview, config };
  } catch (err) {
    reportError("[application] couldn't load the AI interview", err);
    return { canView, canManage, interview: null, config: null };
  }
});
