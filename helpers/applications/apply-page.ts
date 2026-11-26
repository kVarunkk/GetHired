import "server-only";
import { getStaticJobDetails } from "@/helpers/jobs/jobId/get-job-details";
import { readRef } from "@/helpers/careers/params";
import { careersPath } from "@/helpers/careers/slug";
import { readSourceTag } from "@/helpers/distribution/source-tag";
import { careersApplyPath, jobApplyPath } from "@/helpers/jobs/apply-path";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { createClient } from "@/lib/supabase/server";
import type { TJobIdPageData } from "@/utils/types/jobs.types";

export type ApplyPageResult =
  | { kind: "redirect"; to: string }
  | { kind: "not_found" }
  | {
      kind: "form";
      job: TJobIdPageData;
      userId: string;
      source: "careers_page" | "job_board" | undefined;
      ref: string | undefined;
      /** Where to go after applying (or later): the job page the button shows the status on. */
      doneHref: string;
    };

/**
 * AP-REQ-011: the access checks for both apply routes, in order. The server
 * action stays the authority (AP-REQ-012). `careers` is set by the careers
 * route, whose source is `careers_page` whatever the query says (AP-REQ-020).
 */
export async function loadApplyPage(
  jobId: string,
  { query, careers }: { query: URLSearchParams; careers?: { slug: string } },
): Promise<ApplyPageResult> {
  const job = await getStaticJobDetails(jobId);
  if (!job) return { kind: "not_found" };

  const ref = careers ? readRef(query) : null;
  const tag = careers ? null : readSourceTag(query);
  const jobHref = careers
    ? `${careersPath(careers.slug)}/jobs/${jobId}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`
    : `/jobs/${jobId}`;

  if (!job.is_platform_job) return { kind: "redirect", to: jobHref };

  const user = await getUserFromRequest();
  if (!user) {
    const here = careers ? careersApplyPath(careers.slug, jobId, ref) : jobApplyPath(jobId, tag);
    return { kind: "redirect", to: `/auth/login?returnTo=${encodeURIComponent(here)}` };
  }
  if (user.app_metadata?.type === "company") return { kind: "redirect", to: jobHref };

  const supabase = await createClient();
  const { data: info } = await supabase.from("user_info").select("filled").eq("user_id", user.id).maybeSingle();
  if (!info?.filled) return { kind: "redirect", to: "/get-started" };

  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("applicant_user_id", user.id)
    .eq("all_jobs_id", jobId)
    .limit(1);
  if (existing && existing.length > 0) return { kind: "redirect", to: jobHref };

  return {
    kind: "form",
    job,
    userId: user.id,
    source: careers ? "careers_page" : tag ? "job_board" : undefined,
    ref: careers ? (ref ?? undefined) : (tag?.channel ?? undefined),
    doneHref: jobHref,
  };
}
