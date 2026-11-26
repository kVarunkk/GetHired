import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/**
 * Who hears about a job's lifecycle (JL-REQ-015, JL-REQ-017): the company's
 * owners and the job's hiring team (members assigned to it). Service role: it
 * reads other users' memberships and emails. A member who left the company
 * but is still assigned isn't emailed.
 */
export async function jobTeamEmails(
  admin: SupabaseClient<Database>,
  companyId: string,
  jobPostId: string,
): Promise<string[]> {
  const [{ data: members, error }, { data: assignments, error: assignmentsError }] = await Promise.all([
    admin.from("company_members").select("user_id, is_owner").eq("company_id", companyId),
    admin.from("company_job_assignments").select("user_id").eq("company_id", companyId).eq("job_post_id", jobPostId),
  ]);
  if (error) throw new Error(`Couldn't load the team: ${error.message}`);
  if (assignmentsError) throw new Error(`Couldn't load the hiring team: ${assignmentsError.message}`);

  const assigned = new Set((assignments ?? []).map((a) => a.user_id));
  const userIds = (members ?? []).filter((m) => m.is_owner || assigned.has(m.user_id)).map((m) => m.user_id);

  const emails = await Promise.all(
    userIds.map(async (id) => (await admin.auth.admin.getUserById(id)).data.user?.email ?? null),
  );
  return [...new Set(emails.filter((e): e is string => !!e))];
}

/**
 * The members whose role holds `permission` on the job (scope `all`, or
 * `assigned` and assigned to it), not counting owners, who pass every check
 * but are listed apart in `owners`. Service role, as above.
 */
export async function jobPermissionHolders(
  admin: SupabaseClient<Database>,
  companyId: string,
  jobPostId: string,
  permission: string,
): Promise<{ holders: string[]; owners: string[] }> {
  const { data: members, error } = await admin
    .from("company_members")
    .select("user_id, is_owner, role_id")
    .eq("company_id", companyId);
  if (error) throw new Error(`Couldn't load the team: ${error.message}`);

  const roleIds = [...new Set((members ?? []).map((m) => m.role_id).filter((id): id is string => !!id))];
  const [{ data: grants, error: grantsError }, { data: assignments, error: assignmentsError }] = await Promise.all([
    roleIds.length
      ? admin.from("company_role_permissions").select("role_id, scope").eq("permission_key", permission).in("role_id", roleIds)
      : Promise.resolve({ data: [] as { role_id: string; scope: string }[], error: null }),
    admin.from("company_job_assignments").select("user_id").eq("company_id", companyId).eq("job_post_id", jobPostId),
  ]);
  if (grantsError) throw new Error(`Couldn't load the roles: ${grantsError.message}`);
  if (assignmentsError) throw new Error(`Couldn't load the hiring team: ${assignmentsError.message}`);

  const scopeOf = new Map((grants ?? []).map((g) => [g.role_id, g.scope]));
  const assigned = new Set((assignments ?? []).map((a) => a.user_id));
  const holders: string[] = [];
  const owners: string[] = [];
  for (const m of members ?? []) {
    if (m.is_owner) {
      owners.push(m.user_id);
      continue;
    }
    const scope = m.role_id ? scopeOf.get(m.role_id) : undefined;
    if (scope === "all" || (scope === "assigned" && assigned.has(m.user_id))) holders.push(m.user_id);
  }
  return { holders, owners };
}

/** The sign-in emails of `userIds`, skipping anyone without one. */
export async function emailsOf(admin: SupabaseClient<Database>, userIds: string[]): Promise<string[]> {
  const emails = await Promise.all(
    [...new Set(userIds)].map(async (id) => (await admin.auth.admin.getUserById(id)).data.user?.email ?? null),
  );
  return [...new Set(emails.filter((e): e is string => !!e))];
}
