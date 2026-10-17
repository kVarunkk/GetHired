import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/utils/types/database.types";

/** sha256(token), hex: what `company_invites.token_hash` stores (`team_invite_hash` in SQL). */
export function hashInviteToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Tokens are 32 random bytes in base64url (43 characters); anything else isn't one. */
export function isPlausibleInviteToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{20,100}$/.test(token);
}

export const joinPath = (token: string) => `/company/join?token=${encodeURIComponent(token)}`;

export type OpenInvite = {
  id: string;
  email: string;
  /** The role they'll join with: the invite's, or the default role if it was deleted. */
  role: { id: string; name: string } | null;
  /** RP-REQ-007: the invite's role was deleted, so the default role applies. */
  roleFellBack: boolean;
  expires_at: string;
  company: { id: string; name: string | null; logo_url: string | null } | null;
  invitedBy: string | null;
};

/**
 * The open invite (not accepted, revoked or expired) for a token, looked up by
 * its hash with the service role. Only the invite, the role it joins with and
 * the company's name and logo: what the join page and invite-mode sign-up
 * need, nothing else.
 */
export async function findOpenInvite(
  service: SupabaseClient<Database>,
  token: string,
): Promise<OpenInvite | null> {
  if (!isPlausibleInviteToken(token)) return null;

  const { data, error } = await service
    .from("company_invites")
    .select("id, email, role_id, expires_at, invited_by, company_id, company_info(id, name, logo_url)")
    .eq("token_hash", hashInviteToken(token))
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;

  let invitedBy: string | null = null;
  if (data.invited_by) {
    const { data: name } = await service.rpc("member_display_name", { p_user_id: data.invited_by });
    invitedBy = typeof name === "string" ? name : null;
  }

  // Accepting falls back to the default role when the invite's role is gone.
  const roleFor = async (roleId: string | null) => {
    if (!roleId) return null;
    const { data: role } = await service
      .from("company_roles")
      .select("id, name")
      .eq("id", roleId)
      .eq("company_id", data.company_id)
      .maybeSingle();
    return role ?? null;
  };
  let role = await roleFor(data.role_id);
  let roleFellBack = false;
  if (!role) {
    roleFellBack = true;
    const { data: company } = await service
      .from("company_info")
      .select("default_role_id")
      .eq("id", data.company_id)
      .maybeSingle();
    role = await roleFor(company?.default_role_id ?? null);
  }

  return {
    id: data.id,
    email: data.email,
    role,
    roleFellBack,
    expires_at: data.expires_at,
    company: data.company_info,
    invitedBy,
  };
}
