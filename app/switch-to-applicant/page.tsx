import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { APPLICANT_SIGN_UP_PATH } from "@/helpers/user/account-switch";
import { APPLICANT_HOME } from "@/helpers/user/home-path";
import SwitchAccount from "@/components/SwitchAccount";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create a candidate account",
  robots: { index: false, follow: false },
};

/**
 * Where a signed-in company user lands when they try to look for a job
 * (candidate sign-up, any /agent link such as the blog CTA, or the recruiter
 * agent's link). A candidate account is a
 * separate login with a different email, so they sign out first. Public in the
 * middleware: signed-out visitors go straight to candidate sign-up.
 */
export default async function SwitchToApplicantPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(APPLICANT_SIGN_UP_PATH);
  // Applicants are already there; an account without a role gets the job board.
  if (user.app_metadata?.type !== "company") {
    redirect(user.app_metadata?.type === "applicant" ? APPLICANT_HOME : "/jobs");
  }

  return <SwitchAccount to="applicant" email={user.email ?? null} />;
}
