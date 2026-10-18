import "server-only";
import { render } from "react-email";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import CompanyInviteEmail from "@/emails/CompanyInviteEmail";
import type { MyCompany } from "@/helpers/companies/get-my-company";
import { assertLimit } from "@/helpers/billing/entitlements";
import { EntitlementError, toEntitlementActionError, type EntitlementActionError } from "@/helpers/billing/errors";
import { sendEmail } from "@/utils/email";
import { deploymentUrl } from "@/utils/formatters";
import type { Database } from "@/utils/types/database.types";
import type { ActorKind } from "@/helpers/companies/role-rpc";
import { asTeamRpcResult, teamErrorMessage } from "./errors";

export type CreatedInvite = { id: string; email: string; role: { id: string; name: string } };

export type CreateInviteResult =
  | { ok: true; invite: CreatedInvite }
  | { ok: false; error: string }
  | ({ ok: false } & EntitlementActionError);

type Deps = { supabase: SupabaseClient<Database>; user: User; company: MyCompany };

export const inviteJoinUrl = (token: string) =>
  `${deploymentUrl()}/company/join?token=${encodeURIComponent(token)}`;

/** The name the invite email shows for the inviter. */
export const inviterName = (user: User, company: MyCompany) =>
  company.displayName?.trim() || user.email?.split("@")[0] || "A teammate";

/**
 * Creates an invite and emails its token (TM-REQ-002, TM-SEC-002). The token
 * comes back from `create_company_invite` once, goes into exactly one email,
 * and is never returned, logged or tracked. The caller has already checked
 * team.invite; the RPC checks it again, and the role's ceiling (RP-REQ-012).
 * No `roleId` means the company's default role. `actorKind` "agent" marks the
 * audit entry as the recruiter agent's.
 */
export async function createAndSendInvite(
  { supabase, user, company }: Deps,
  { email, roleId }: { email: string; roleId?: string | null },
  actorKind: ActorKind = "user",
): Promise<CreateInviteResult> {
  // BLT-103: seats are members plus open invites. The RPC checks again in its
  // transaction; this gives the plan's upgrade message first.
  try {
    await assertLimit(company.id, "seats");
  } catch (err) {
    if (err instanceof EntitlementError) return { ok: false, ...toEntitlementActionError(err) };
    throw err;
  }

  const { data, error } = await supabase.rpc("create_company_invite", {
    p_email: email,
    ...(roleId ? { p_role_id: roleId } : {}),
    ...(actorKind === "agent" ? { p_actor_kind: actorKind } : {}),
  });
  if (error) return { ok: false, error: teamErrorMessage("unknown") };
  const result = asTeamRpcResult(data);
  if (!result.ok) return { ok: false, error: teamErrorMessage(result.reason) };

  const id = String(result.id);
  const token = String(result.token);
  const created = result.role as { id: string; name: string } | undefined;
  const invite: CreatedInvite = {
    id,
    email: email.trim().toLowerCase(),
    role: { id: created?.id ?? roleId ?? "", name: created?.name ?? "Member" },
  };

  const message = (
    <CompanyInviteEmail
      companyName={company.name ?? "your company"}
      inviterName={inviterName(user, company)}
      roleName={invite.role.name}
      joinUrl={inviteJoinUrl(token)}
    />
  );
  try {
    const [htmlContent, textContent] = await Promise.all([
      render(message),
      render(message, { plainText: true }),
    ]);
    await sendEmail({
      toEmail: invite.email,
      subject: `Join ${company.name ?? "your team"} on GetHired`,
      htmlContent,
      textContent,
    });
  } catch {
    // The invite stays; resending makes a new token. Never log the token.
    console.error("[team] invite email failed for invite", id);
    return { ok: false, error: "The invite was created but the email didn't send. Resend it." };
  }

  return { ok: true, invite };
}
