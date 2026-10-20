import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRoleSummary } from "@/helpers/companies/get-my-company";
import type { Database } from "@/utils/types/database.types";

export type HiringTeamMember = {
  userId: string;
  email: string | null;
  name: string | null;
  isOwner: boolean;
  /** Null for owners (RP-DEC-001). */
  role: CompanyRoleSummary | null;
  assigned: boolean;
  /** Whether `assign_job` would accept this member for the caller. */
  assignable: boolean;
  /** Whether `unassign_job` would accept this member for the caller. */
  removable: boolean;
};

type RawMember = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  is_owner: boolean;
  role: CompanyRoleSummary | null;
  assigned: boolean;
  assignable: boolean;
  removable: boolean;
};

/**
 * RP-REQ-011: the company's members as one job's Hiring team panel sees them.
 * `list_job_hiring_team` returns null when the caller lacks jobs.assign on the
 * job (or it isn't their company's), and so does this.
 */
export async function listJobHiringTeam(
  supabase: SupabaseClient<Database>,
  jobPostId: string,
): Promise<HiringTeamMember[] | null> {
  const { data, error } = await supabase.rpc("list_job_hiring_team", { p_job_post_id: jobPostId });
  if (error) throw new Error(`Failed to load the hiring team: ${error.message}`);
  if (!Array.isArray(data)) return null;

  return (data as RawMember[]).map((m) => ({
    userId: m.user_id,
    email: m.email,
    name: m.display_name,
    isOwner: Boolean(m.is_owner),
    role: m.role ?? null,
    assigned: Boolean(m.assigned),
    assignable: Boolean(m.assignable),
    removable: Boolean(m.removable),
  }));
}
