import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { COMPANY_SIGN_UP_PATH } from "@/helpers/user/account-switch";
import { COMPANY_HOME } from "@/helpers/user/home-path";
import SwitchAccount from "@/components/SwitchAccount";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a company account",
  robots: { index: false, follow: false },
};

/**
 * Where a signed-in applicant lands when they try to start hiring (company
 * sign-up or login, a /company page, or the agent's link). A company account
 * is a separate login with a work email, so they sign out first. Public in
 * the middleware: signed-out visitors go straight to company sign-up.
 */
export default async function SwitchToCompanyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(COMPANY_SIGN_UP_PATH);
  // Companies are already there; an account without a role gets the job board.
  if (user.app_metadata?.type !== "applicant") {
    redirect(user.app_metadata?.type === "company" ? COMPANY_HOME : "/jobs");
  }

  return <SwitchAccount to="company" email={user.email ?? null} />;
}
