import "server-only";
import { reportError } from "@/helpers/posthog/report-error";
import { cache } from "react";
import { isUuid } from "@/helpers/agent/auth";
import { applicationPerson, COMPANY_CANDIDATE_PERSON_COLUMNS } from "@/helpers/applications/application-person";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { can } from "@/helpers/companies/permissions";
import { getApplicationInterview } from "@/helpers/interview/screening/application-interview";
import { getInterviewConfig } from "@/helpers/interview/screening/config";
import { createClient } from "@/lib/supabase/server";

export const applicationPath = (applicationId: string) => `/company/applications/${applicationId}`;

/**
 * What every page of an application's layout needs: the session, the
 * company and the application with its person (a GetHired applicant or a
 * company candidate, BI-REQ-030) and job, and its merges (BI-REQ-042):
 * `mergedInto` (this imported application was merged into that one, so
 * it's read-only) and `mergedFrom` (imported ones merged into this), and
 * `importedCandidateIds`: the company's own records behind it, its candidate
 * or, for a direct application, the merged imports' (BIT-102). Cached for
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

  const [company, { data: application, error }, { data: merged, error: mergedError }] = await Promise.all([
    getMyCompany(supabase, user),
    supabase
      .from("applications")
      .select(
        `id, applicant_user_id, company_candidate_id, merged_into_application_id, source, created_at, status, stage_id, job_post_id, user_info(full_name), ${COMPANY_CANDIDATE_PERSON_COLUMNS}, job_postings(id, title, company_id)` as const,
      )
      .eq("id", applicationId)
      .maybeSingle(),
    supabase
      .from("applications")
      .select("id, company_candidate_id")
      .eq("merged_into_application_id", applicationId),
  ]);
  if (error) throw error;
  if (mergedError) throw mergedError;
  if (!company || !application) return null;
  return {
    supabase,
    user,
    company,
    application,
    person: applicationPerson(application),
    jobId: application.job_post_id ?? undefined,
    mergedInto: application.merged_into_application_id,
    mergedFrom: (merged ?? []).map((m) => m.id),
    importedCandidateIds: application.company_candidate_id
      ? [application.company_candidate_id]
      : [...new Set((merged ?? []).flatMap((m) => (m.company_candidate_id ? [m.company_candidate_id] : [])))],
  };
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
