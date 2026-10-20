import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getMyCompany } from "@/helpers/companies/get-my-company";
import { findOpenInvite } from "@/helpers/team/invite-token";
import JoinCompany, { type JoinState } from "@/components/team/JoinCompany";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join your team",
  robots: { index: false, follow: false },
};

/**
 * `/company/join?token=…` (TM-REQ-003, TMT-041). The invite is loaded with the
 * service role by the token's hash, and only its company's name, the
 * inviter's name, the role and the invited email are shown. Public in the
 * middleware; the state below decides what each visitor sees.
 */
export default async function JoinCompanyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const invite = token ? await findOpenInvite(createServiceRoleClient(), token) : null;
  if (!invite) return <JoinCompany state="invalid" token="" />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let state: JoinState = "signed_out";
  if (user) {
    if ((user.email ?? "").toLowerCase() !== invite.email.toLowerCase()) state = "wrong_email";
    else if (user.app_metadata?.type === "applicant") state = "applicant";
    else if (await getMyCompany(supabase, user).catch(() => null)) state = "already_member";
    else state = "ready";
  }

  return (
    <JoinCompany
      state={state}
      token={token}
      signedInEmail={user?.email ?? null}
      invite={{
        companyName: invite.company?.name ?? "the company",
        inviterName: invite.invitedBy,
        roleName: invite.role?.name ?? null,
        roleFellBack: invite.roleFellBack,
        email: invite.email,
      }}
    />
  );
}
