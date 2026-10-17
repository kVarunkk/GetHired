import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRoleSummary } from "@/helpers/companies/get-my-company";
import type { Database } from "@/utils/types/database.types";

export type HiringTeamsJob = {
  id: string;
  title: string;
  status: Database["public"]["Enums"]["job_posting_status"];
  createdAt: string;
  assignedUserIds: string[];
};

export type HiringTeamsMember = {
  userId: string;
  email: string | null;
  name: string | null;
  isOwner: boolean;
  /** Null for owners (RP-DEC-001). */
  role: CompanyRoleSummary | null;
  /** Whether `assign_job` would accept this member for the caller, on any listed job. */
  assignable: boolean;
  /** Whether `unassign_job` would accept this member for the caller, on any listed job. */
  removable: boolean;
};

export type HiringTeams = { jobs: HiringTeamsJob[]; members: HiringTeamsMember[] };

type Raw = {
  jobs?: {
    id: string;
    title: string;
    status: HiringTeamsJob["status"];
    created_at: string;
    assigned_user_ids: string[] | null;
  }[];
  members?: {
    user_id: string;
    email: string | null;
    display_name: string | null;
    is_owner: boolean;
    role: CompanyRoleSummary | null;
    assignable: boolean;
    removable: boolean;
  }[];
};

/**
 * RP-REQ-011: every job the caller has jobs.assign on, with who is assigned,
 * and the company's members, for the central Hiring teams page.
 * `list_company_hiring_teams` returns null when the caller doesn't hold
 * jobs.assign at any scope, and so does this.
 */
export async function listCompanyHiringTeams(supabase: SupabaseClient<Database>): Promise<HiringTeams | null> {
  const { data, error } = await supabase.rpc("list_company_hiring_teams");
  if (error) throw new Error(`Failed to load the hiring teams: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const raw = data as Raw;

  return {
    jobs: (raw.jobs ?? []).map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      createdAt: j.created_at,
      assignedUserIds: j.assigned_user_ids ?? [],
    })),
    members: (raw.members ?? []).map((m) => ({
      userId: m.user_id,
      email: m.email,
      name: m.display_name,
      isOwner: Boolean(m.is_owner),
      role: m.role ?? null,
      assignable: Boolean(m.assignable),
      removable: Boolean(m.removable),
    })),
  };
}
