import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyRoleSummary, MyCompany } from "@/helpers/companies/get-my-company";
import { getEntitlements } from "@/helpers/billing/entitlements";
import type { Database } from "@/utils/types/database.types";

export type TeamMember = {
  userId: string;
  email: string | null;
  name: string | null;
  isOwner: boolean;
  isPrimaryOwner: boolean;
  /** Null for owners (RP-DEC-001). */
  role: CompanyRoleSummary | null;
  assignedJobIds: string[];
  joinedAt: string;
  lastActiveAt: string | null;
};

export type TeamInvite = {
  id: string;
  email: string;
  /** Null when the invite's role was deleted: it'll get the default role (RP-REQ-007). */
  role: CompanyRoleSummary | null;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
};

export type Team = {
  members: TeamMember[];
  invites: TeamInvite[];
  /** Members plus open invites, against the plan's limit (null = unlimited). */
  seats: { used: number; limit: number | null };
};

type RawTeam = {
  members?: {
    user_id: string;
    email: string | null;
    display_name: string | null;
    is_owner: boolean;
    is_primary_owner: boolean;
    role: CompanyRoleSummary | null;
    assigned_job_ids?: string[] | null;
    joined_at: string;
    last_active_at: string | null;
  }[];
  invites?: {
    id: string;
    email: string;
    role: CompanyRoleSummary | null;
    invited_by: string | null;
    created_at: string;
    expires_at: string;
  }[];
};

/**
 * TM-REQ-006 / RP-REQ-013: the session company's members (with emails, which
 * members can't read from auth.users themselves, so `list_company_team` is
 * security definer, scoped to the caller's company and needs team.view) and
 * open invites. The primary owner first, then owners, then by role.
 */
export async function listTeam(supabase: SupabaseClient<Database>, company: MyCompany): Promise<Team> {
  const [{ data, error }, entitlements] = await Promise.all([
    supabase.rpc("list_company_team"),
    getEntitlements(company.id),
  ]);
  if (error) throw new Error(`Failed to load the team: ${error.message}`);
  const raw = (data ?? {}) as RawTeam;

  const members = (raw.members ?? []).map((m) => ({
    userId: m.user_id,
    email: m.email,
    name: m.display_name,
    isOwner: Boolean(m.is_owner),
    isPrimaryOwner: Boolean(m.is_primary_owner),
    role: m.role ?? null,
    assignedJobIds: m.assigned_job_ids ?? [],
    joinedAt: m.joined_at,
    lastActiveAt: m.last_active_at,
  }));

  const invites = (raw.invites ?? []).map((i) => ({
    id: i.id,
    email: i.email,
    role: i.role ?? null,
    invitedBy: i.invited_by,
    createdAt: i.created_at,
    expiresAt: i.expires_at,
  }));

  const seats = entitlements.entitlements.seats;
  return {
    members,
    invites,
    seats: { used: members.length + invites.length, limit: seats?.amount ?? null },
  };
}
