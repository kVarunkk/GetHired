import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";
import { asTeamRpcResult, teamErrorMessage } from "@/helpers/team/errors";
import { limitsPayload, type RoleFields } from "./role-input";
import type { PermissionGrant } from "./permissions";

// The role and assignment RPCs, shared by the server actions and the
// recruiter agent's role tools (RP-REQ-032: the same RPCs, so RP-REQ-012
// applies to both). The caller has already resolved the session company; the
// RPCs resolve it again with my_company_id() and never take it as input.

export type RoleRpcResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; reason: string };
export type ActorKind = "user" | "agent";

type Db = SupabaseClient<Database>;

function revalidateRoles() {
  revalidatePath("/company/settings/roles");
  revalidatePath("/company/settings/team");
  revalidatePath("/company/settings/audit");
}

async function call<T extends object>(
  run: () => PromiseLike<{ data: unknown; error: unknown }>,
  pick: (data: Record<string, unknown>) => T,
): Promise<RoleRpcResult<T>> {
  const { data, error } = await run();
  if (error) return { ok: false, error: teamErrorMessage("unknown"), reason: "unknown" };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason), reason: result.reason };
  revalidateRoles();
  return { ok: true, ...pick(result) };
}

const grantsJson = (grants: PermissionGrant[]) => grants.map((g) => ({ key: g.key, scope: g.scope }));

export function createRole(
  supabase: Db,
  fields: RoleFields & { templateKey?: string | null },
  actorKind: ActorKind = "user",
) {
  return call(
    () =>
      supabase.rpc("create_company_role", {
        p_name: fields.name,
        p_description: fields.description ?? "",
        p_color: fields.color,
        p_grants: grantsJson(fields.grants),
        p_limits: limitsPayload(fields.limits),
        ...(fields.templateKey ? { p_template_key: fields.templateKey } : {}),
        p_actor_kind: actorKind,
      }),
    (r) => ({ id: String(r.id) }),
  );
}

export function updateRole(
  supabase: Db,
  roleId: string,
  fields: Partial<RoleFields>,
  actorKind: ActorKind = "user",
) {
  return call(
    () =>
      supabase.rpc("update_company_role", {
        p_role_id: roleId,
        ...(fields.name !== undefined ? { p_name: fields.name } : {}),
        ...(fields.description !== undefined ? { p_description: fields.description } : {}),
        ...(fields.color !== undefined ? { p_color: fields.color } : {}),
        ...(fields.grants !== undefined ? { p_grants: grantsJson(fields.grants) } : {}),
        ...(fields.limits !== undefined ? { p_limits: limitsPayload(fields.limits) } : {}),
        p_actor_kind: actorKind,
      }),
    () => ({}),
  );
}

export function deleteRole(
  supabase: Db,
  roleId: string,
  replacementRoleId: string | null,
  actorKind: ActorKind = "user",
) {
  return call(
    () =>
      supabase.rpc("delete_company_role", {
        p_role_id: roleId,
        ...(replacementRoleId ? { p_replacement_role_id: replacementRoleId } : {}),
        p_actor_kind: actorKind,
      }),
    (r) => ({ moved: Number(r.moved ?? 0) }),
  );
}

export function setDefaultRole(supabase: Db, roleId: string, actorKind: ActorKind = "user") {
  return call(
    () => supabase.rpc("set_default_company_role", { p_role_id: roleId, p_actor_kind: actorKind }),
    () => ({}),
  );
}

export function assignMemberRole(supabase: Db, userId: string, roleId: string, actorKind: ActorKind = "user") {
  return call(
    () =>
      supabase.rpc("set_company_member_role", { p_user_id: userId, p_role_id: roleId, p_actor_kind: actorKind }),
    () => ({}),
  );
}

export function assignJob(supabase: Db, jobPostId: string, userId: string, actorKind: ActorKind = "user") {
  return call(
    () => supabase.rpc("assign_job", { p_job_post_id: jobPostId, p_user_id: userId, p_actor_kind: actorKind }),
    () => ({}),
  );
}

export function unassignJob(supabase: Db, jobPostId: string, userId: string, actorKind: ActorKind = "user") {
  return call(
    () => supabase.rpc("unassign_job", { p_job_post_id: jobPostId, p_user_id: userId, p_actor_kind: actorKind }),
    () => ({}),
  );
}
