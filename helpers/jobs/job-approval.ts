import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { scopeToJobs } from "@/helpers/companies/job-scope";
import { canAny } from "@/helpers/companies/permissions";

// Reads for approval before a job opens (plan/job-states, phase 3). The
// approval history is the job's state events (JL-REQ-004), never a column.

type Client = SupabaseClient<Database>;

/** `company_info.job_approval_required` (JL-REQ-018). */
export async function loadJobApprovalRequired(supabase: Client, companyId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("company_info")
    .select("job_approval_required")
    .eq("id", companyId)
    .maybeSingle();
  if (error) throw new Error("Failed to load the company's approval setting.");
  return Boolean(data?.job_approval_required);
}

export type JobSubmission = { actorUserId: string | null; at: string };

/** The latest submit for approval of a job: who, and when (JL-REQ-020). */
export async function latestSubmission(supabase: Client, jobPostId: string): Promise<JobSubmission | null> {
  const { data } = await supabase
    .from("job_post_state_events")
    .select("actor_user_id, created_at")
    .eq("job_post_id", jobPostId)
    .eq("to_state", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { actorUserId: data.actor_user_id, at: data.created_at } : null;
}

/**
 * Whether the job was edited after it was submitted (JL-REQ-020), so the
 * approver knows the version they see isn't the one first sent. A second
 * of slack covers the submit's own `updated_at` touch.
 */
export function editedAfterSubmission(updatedAt: string | null | undefined, submission: JobSubmission | null): boolean {
  if (!updatedAt || !submission) return false;
  return new Date(updatedAt).getTime() - new Date(submission.at).getTime() > 1000;
}

export type ApprovalStatus =
  | {
      kind: "pending";
      submittedAt: string;
      submitterId: string | null;
      submitterName: string | null;
      editedAfterSubmission: boolean;
    }
  | { kind: "changes_requested"; note: string; at: string; byName: string | null };

/**
 * What the Overview's approval notice shows (JL-REQ-020): for a pending job,
 * its submission; for a draft an approver sent back, their note. Read from
 * the job's latest state event; null for anything else.
 */
export async function loadApprovalStatus(
  supabase: Client,
  job: { id: string; company_id: string; state: string; updated_at: string | null },
): Promise<ApprovalStatus | null> {
  if (job.state !== "pending_approval" && job.state !== "draft") return null;
  const { data: event } = await supabase
    .from("job_post_state_events")
    .select("from_state, to_state, note, actor_user_id, created_at")
    .eq("job_post_id", job.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!event) return null;

  if (job.state === "pending_approval" && event.to_state === "pending_approval") {
    const submission = { actorUserId: event.actor_user_id, at: event.created_at };
    return {
      kind: "pending",
      submittedAt: event.created_at,
      submitterId: event.actor_user_id,
      submitterName: await memberName(supabase, job.company_id, event.actor_user_id),
      editedAfterSubmission: editedAfterSubmission(job.updated_at, submission),
    };
  }
  // A withdraw has no note, a request for changes always does (the RPC requires it).
  if (job.state === "draft" && event.from_state === "pending_approval" && event.note) {
    return {
      kind: "changes_requested",
      note: event.note,
      at: event.created_at,
      byName: await memberName(supabase, job.company_id, event.actor_user_id),
    };
  }
  return null;
}

async function memberName(supabase: Client, companyId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from("company_members")
    .select("display_name")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.display_name?.trim() || null;
}

/**
 * How many jobs wait for the viewer's approval (JL-REQ-022), for the nav
 * badge: pending jobs the viewer's `jobs.approve` covers. 0 without it.
 */
export async function countPendingApprovals(supabase: Client, company: MyCompany): Promise<number> {
  if (!canAny(company, "jobs.approve")) return 0;
  const query = supabase
    .from("job_postings")
    .select("id", { count: "exact", head: true })
    .eq("company_id", company.id)
    .eq("state", "pending_approval");
  const { count, error } = await scopeToJobs(query, company, "jobs.approve");
  if (error) throw new Error("Failed to count the jobs waiting for approval.");
  return count ?? 0;
}
