import "server-only";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorKind } from "@/helpers/companies/role-rpc";
import type { Database } from "@/utils/types/database.types";
import { asTeamRpcResult, teamErrorMessage } from "./errors";

/**
 * Removes a member from the session company (or, with their own id, leaves
 * it), shared by removeMemberAction and the recruiter agent's
 * removeTeamMember tool. The caller has already checked team.remove for
 * someone else; the RPC checks it again and refuses the primary owner, an
 * owner (unless the caller is one) and someone above the caller's role.
 */
export async function removeMember(
  supabase: SupabaseClient<Database>,
  userId: string,
  actorKind: ActorKind = "user",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("remove_company_member", {
    p_user_id: userId,
    ...(actorKind === "agent" ? { p_actor_kind: actorKind } : {}),
  });
  if (error) return { ok: false, error: teamErrorMessage("unknown") };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason) };
  revalidatePath("/company/settings/team");
  return { ok: true };
}
